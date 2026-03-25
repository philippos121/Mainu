"""Service for fetching and comparing versions of RIS Bundesrecht provisions.

Correct approach based on RIS OGD API v2.6 documentation:

1. Query /Bundesrecht with Gesetzesnummer + ArtikelParagraphAnlage (current version).
2. Query /Bundesrecht with same params + FassungVom (day before Inkrafttretensdatum)
   to get the previous version.
3. Each version response contains ContentUrl links (HTML, XML, etc.)
   — the actual text is NOT in the JSON, only metadata + URLs.
4. Fetch the HTML ContentUrl for each version to get the legal text.
5. Compute word-level diff.
"""

import difflib
import html as html_module
import logging
import re
from datetime import datetime, timedelta

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

_BROWSER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "de-AT,de;q=0.9,en;q=0.5",
}

BASE_URL = settings.RIS_API_BASE_URL  # https://data.bka.gv.at/ris/api/v2.6


# ── Public API ──

async def fetch_provision_diff(
    gesetzesnummer: str,
    artikel: str,
    inkrafttreten: str,
) -> dict:
    """Fetch current + previous version of a provision and return diff.

    Args:
        gesetzesnummer: Law number (e.g. "10001702" for UGB)
        artikel: Section identifier (e.g. "§ 123")
        inkrafttreten: Inkrafttretensdatum of the current version (YYYY-MM-DD or DD.MM.YYYY)
    """
    # 1. Fetch current version via API
    logger.info(f"Diff: GesNr={gesetzesnummer}, Art={artikel}, Inkraft={inkrafttreten}")

    current = await _fetch_version_via_api(gesetzesnummer, artikel, fassung_vom=None)
    if not current or not current.get("text"):
        # Fallback: try fetching from website
        current = await _fetch_version_via_website(gesetzesnummer, artikel, fassung_vom=None)

    if not current or not current.get("text"):
        return _error_result("Aktueller Dokumenttext konnte nicht geladen werden.")

    # 2. Compute the FassungVom date = Inkrafttretensdatum - 1 day
    fassung_vom = _day_before(inkrafttreten)
    if not fassung_vom:
        return {
            "current": {"text": current["text"], "info": current.get("bgbl", ""), "date": inkrafttreten},
            "previous": None,
            "diff_html": _format_no_previous(current["text"]),
            "has_changes": False,
        }

    # 3. Fetch previous version
    logger.info(f"Fetching previous version with FassungVom={fassung_vom}")
    prev = await _fetch_version_via_api(gesetzesnummer, artikel, fassung_vom=fassung_vom)
    if not prev or not prev.get("text"):
        prev = await _fetch_version_via_website(gesetzesnummer, artikel, fassung_vom=fassung_vom)

    # 4. Compute diff
    if prev and prev.get("text") and prev["text"].strip() != current["text"].strip():
        diff_html = _compute_word_diff(prev["text"], current["text"])
        has_changes = True
    elif prev and prev.get("text") and prev["text"].strip() == current["text"].strip():
        diff_html = (
            '<p class="diff-info">Kein inhaltlicher Unterschied zwischen der aktuellen '
            f'Fassung und der Fassung vom {fassung_vom}. Es handelt sich vermutlich um '
            'ein reines RIS-Metadaten-Update.</p>'
            f'<div class="diff-current">{html_module.escape(current["text"])}</div>'
        )
        has_changes = False
    else:
        diff_html = _format_no_previous(current["text"])
        has_changes = False

    return {
        "current": {
            "text": current["text"],
            "info": current.get("bgbl", ""),
            "date": current.get("inkrafttreten", inkrafttreten),
        },
        "previous": {
            "text": prev["text"],
            "info": prev.get("bgbl", ""),
            "date": prev.get("inkrafttreten", f"Fassung vom {fassung_vom}"),
        } if prev and prev.get("text") else None,
        "diff_html": diff_html,
        "has_changes": has_changes,
    }


async def debug_document(
    gesetzesnummer: str,
    artikel: str,
) -> dict:
    """DEBUG: show what the API returns for a provision."""
    result = {}

    # Current version
    api_data = await _query_api(gesetzesnummer, artikel, fassung_vom=None)
    if api_data:
        refs = _extract_refs(api_data)
        result["api_hits"] = _extract_hits(api_data)
        result["api_refs_count"] = len(refs)
        if refs:
            ref = refs[0]
            data_entry = ref.get("Data", {})
            result["data_keys"] = list(data_entry.keys())
            result["metadaten_keys"] = list(data_entry.get("Metadaten", {}).keys())
            m = _flatten_metadata(data_entry)
            result["flat_metadata"] = {k: str(v)[:200] for k, v in m.items()}
            content_urls = _extract_content_urls(data_entry)
            result["content_urls"] = content_urls

            # Fetch HTML content
            html_url = next((u for u in content_urls if "html" in u.lower()), None)
            if html_url:
                text = await _fetch_html_content(html_url)
                result["content_text_preview"] = text[:500] if text else "(empty)"
                result["content_text_length"] = len(text) if text else 0
    else:
        result["api_error"] = "API request failed or empty response"

    # Previous version (1 month ago)
    fassung_vom = (datetime.now() - timedelta(days=30)).strftime("%Y-%m-%d")
    api_data2 = await _query_api(gesetzesnummer, artikel, fassung_vom=fassung_vom)
    if api_data2:
        refs2 = _extract_refs(api_data2)
        result["prev_api_hits"] = _extract_hits(api_data2)
        result["prev_api_refs_count"] = len(refs2)
        if refs2:
            m2 = _flatten_metadata(refs2[0].get("Data", {}))
            result["prev_inkrafttreten"] = m2.get("Inkrafttretensdatum", "")
            result["prev_dokumentnummer"] = m2.get("ID", "") or m2.get("Dokumentnummer", "")
    else:
        result["prev_api_error"] = "Failed"

    return result


# ── Strategy 1: OGD API + ContentUrl ──

async def _fetch_version_via_api(
    gesetzesnummer: str,
    artikel: str,
    fassung_vom: str | None,
) -> dict | None:
    """Fetch a provision version via OGD API, then fetch text from ContentUrl."""
    api_data = await _query_api(gesetzesnummer, artikel, fassung_vom)
    if not api_data:
        return None

    refs = _extract_refs(api_data)
    if not refs:
        logger.info(f"API returned 0 refs (FassungVom={fassung_vom})")
        return None

    ref = refs[0]
    data_entry = ref.get("Data", {})
    m = _flatten_metadata(data_entry)

    # Get ContentUrls
    content_urls = _extract_content_urls(data_entry)
    logger.info(f"ContentUrls found: {content_urls}")

    # Prefer HTML, then XML
    text = ""
    html_url = next((u for u in content_urls if "html" in u.lower()), None)
    xml_url = next((u for u in content_urls if "xml" in u.lower()), None)

    for url in [html_url, xml_url]:
        if url:
            text = await _fetch_html_content(url)
            if text and len(text) > 20:
                break

    if not text:
        logger.info("Could not fetch text from ContentUrls")
        return None

    return {
        "text": _remove_accessible_duplicates(text),
        "bgbl": m.get("Kundmachungsorgan", ""),
        "inkrafttreten": m.get("Inkrafttretensdatum", ""),
        "doc_id": m.get("ID", "") or m.get("Dokumentnummer", ""),
    }


async def _query_api(
    gesetzesnummer: str,
    artikel: str,
    fassung_vom: str | None,
) -> dict | None:
    """Query the RIS OGD API for a specific provision."""
    params = {
        "Applikation": "BrKons",
        "Gesetzesnummer": gesetzesnummer,
        "ArtikelParagraphAnlage": artikel,
        "DokumenteProSeite": "Ten",
        "Seitennummer": "1",
    }
    if fassung_vom:
        params["Fassung.FassungVom"] = fassung_vom

    url = f"{BASE_URL}/Bundesrecht"
    logger.info(f"API query: {params}")

    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            resp = await client.get(url, params=params)
            resp.raise_for_status()
            return resp.json()
        except Exception as e:
            logger.error(f"API error: {e}")
            return None


# ── Strategy 2: RIS Website fallback ──

async def _fetch_version_via_website(
    gesetzesnummer: str,
    artikel: str,
    fassung_vom: str | None,
) -> dict | None:
    """Fallback: fetch text from ris.bka.gv.at search page."""
    # Build a search URL on the RIS website
    params = f"Gesetzesnummer={gesetzesnummer}&Artikel={artikel}"
    if fassung_vom:
        params += f"&FassungVom={fassung_vom}"

    # Try the direct NOR lookup approach: search the website
    search_url = (
        f"https://www.ris.bka.gv.at/Ergebnis.wxe"
        f"?Abfrage=Bundesnormen&Gesetzesnummer={gesetzesnummer}"
        f"&Paragraf={artikel.replace('§', '').strip()}"
    )
    if fassung_vom:
        search_url += f"&FassungVom={fassung_vom}"

    logger.info(f"Website fallback: {search_url}")

    async with httpx.AsyncClient(timeout=25.0, follow_redirects=True, headers=_BROWSER_HEADERS) as client:
        try:
            resp = await client.get(search_url)
            resp.raise_for_status()
            # Try to find a document link and follow it
            nor_match = re.search(r'Dokumentnummer=(NOR\d+)', resp.text)
            if not nor_match:
                logger.info("No document link found in search results")
                return None

            nor_id = nor_match.group(1)
            doc_url = f"https://www.ris.bka.gv.at/Dokument.wxe?Abfrage=Bundesnormen&Dokumentnummer={nor_id}"
            if fassung_vom:
                doc_url += f"&FassungVom={fassung_vom}"

            resp2 = await client.get(doc_url)
            resp2.raise_for_status()
            text = _extract_text_from_page(resp2.text)
            if text:
                meta = _extract_metadata_from_page(resp2.text)
                return {
                    "text": _remove_accessible_duplicates(text),
                    "bgbl": meta.get("Kundmachungsorgan", ""),
                    "inkrafttreten": meta.get("Inkrafttretensdatum", ""),
                    "doc_id": nor_id,
                }
        except Exception as e:
            logger.error(f"Website fallback error: {e}")

    return None


# ── Content fetching ──

async def _fetch_html_content(url: str) -> str:
    """Fetch HTML/XML content from a ContentUrl and extract text."""
    logger.info(f"Fetching content: {url}")
    async with httpx.AsyncClient(timeout=20.0, follow_redirects=True, headers=_BROWSER_HEADERS) as client:
        try:
            resp = await client.get(url)
            resp.raise_for_status()
            return _clean_html(resp.text)
        except Exception as e:
            logger.error(f"Failed to fetch content {url}: {e}")
            return ""


# ── Response parsing ──

def _extract_refs(data: dict) -> list[dict]:
    refs = (
        data.get("OgdSearchResult", {})
        .get("OgdDocumentResults", {})
        .get("OgdDocumentReference", [])
    )
    if isinstance(refs, dict):
        refs = [refs]
    return refs or []


def _extract_hits(data: dict) -> int:
    hits = (
        data.get("OgdSearchResult", {})
        .get("OgdDocumentResults", {})
        .get("Hits", {})
    )
    if isinstance(hits, dict):
        text = hits.get("#text", "0")
    else:
        text = str(hits)
    try:
        return int(text)
    except (ValueError, TypeError):
        return 0


def _flatten_metadata(data_entry: dict) -> dict:
    """Flatten nested metadata into a single dict."""
    metadata = data_entry.get("Metadaten", {})
    merged = {}
    for section_key in ("Technisch", "Allgemein", "Bundesrecht"):
        section = metadata.get(section_key)
        if isinstance(section, list) and section:
            section = section[0]
        if isinstance(section, dict):
            merged.update(section)
            # Go deeper (BrKons nested inside Bundesrecht)
            for sub_key in ("BrKons", "LrKons"):
                sub = section.get(sub_key)
                if isinstance(sub, list) and sub:
                    sub = sub[0]
                if isinstance(sub, dict):
                    merged.update(sub)
    return merged


def _extract_content_urls(data_entry: dict) -> list[str]:
    """Recursively find all ContentUrl values in a data entry."""
    urls = []
    _walk_for_urls(data_entry, urls, 0)
    return urls


def _walk_for_urls(obj, urls: list, depth: int):
    if depth > 10:
        return
    if isinstance(obj, dict):
        # Check for ContentUrl patterns
        if "Url" in obj and "DataType" in obj:
            url = obj["Url"]
            if isinstance(url, str) and url.startswith("http"):
                urls.append(url)
        if "ContentUrl" in obj:
            val = obj["ContentUrl"]
            if isinstance(val, str) and val.startswith("http"):
                urls.append(val)
            elif isinstance(val, list):
                for item in val:
                    if isinstance(item, dict) and "Url" in item:
                        urls.append(item["Url"])
                    elif isinstance(item, str) and item.startswith("http"):
                        urls.append(item)
        for v in obj.values():
            _walk_for_urls(v, urls, depth + 1)
    elif isinstance(obj, list):
        for item in obj:
            _walk_for_urls(item, urls, depth + 1)


# ── Website text extraction ──

def _extract_text_from_page(page_html: str) -> str:
    """Extract legal text from a RIS website page."""
    section_labels = [
        "Schlagworte", "Zuletzt aktualisiert",
        "Dokumentnummer", "European Legislation Identifier",
        "Navigation im Suchergebnis", "Zum Seitenanfang",
    ]
    end_pattern = "|".join(re.escape(l) for l in section_labels)

    match = re.search(
        rf'>\s*Text\s*</[^>]+>(.*?)({end_pattern})',
        page_html, re.DOTALL | re.IGNORECASE
    )
    if match:
        text = _clean_html(match.group(1)).strip()
        if len(text) > 20:
            return text

    # Fallback: largest block with legal patterns
    blocks = re.findall(r'<(?:td|div)[^>]*>(.*?)</(?:td|div)>', page_html, re.DOTALL)
    best = ""
    for block in blocks:
        cleaned = _clean_html(block)
        if len(cleaned) > len(best) and len(cleaned) > 100:
            if re.search(r'\(\d+\)|§\s*\d+|Abs\.|Absatz', cleaned):
                best = cleaned
    return best


def _extract_metadata_from_page(page_html: str) -> dict:
    """Extract metadata from a RIS website page."""
    meta = {}
    for html_label, key in [
        ("Kundmachungsorgan", "Kundmachungsorgan"),
        ("Inkrafttretensdatum", "Inkrafttretensdatum"),
    ]:
        escaped = re.escape(html_label)
        match = re.search(rf'>\s*{escaped}\s*</[^>]+>\s*(?:<[^>]+>\s*)*([^<]+)', page_html)
        if match:
            meta[key] = html_module.unescape(match.group(1).strip())
    return meta


# ── Text processing ──

def _remove_accessible_duplicates(text: str) -> str:
    text = re.sub(r'(§\s*\d+[a-z]?\.?)\s*Paragraph\s*\d+[a-z]?,?\s*', r'\1 ', text)
    text = re.sub(
        r'(\(\d+\))\s*Absatz\s*(?:eins|zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn|\d+),?\s*',
        r'\1 ', text
    )
    text = re.sub(r'Anmerkung,\s*aus Bundesgesetzblatt[^)]*\)\s*', '', text)
    text = re.sub(r'\bParagraph\s+\d+,\s*', '', text)
    text = re.sub(r'(§§?\s*\d+[^)]*)\s*Paragraphen\s*\d+[^)]*', r'\1', text)
    text = re.sub(r'  +', ' ', text)
    return text.strip()


def _compute_word_diff(old_text: str, new_text: str) -> str:
    old_words = old_text.split()
    new_words = new_text.split()
    if not old_words and not new_words:
        return "<p class='diff-info'>Beide Versionen sind leer.</p>"

    matcher = difflib.SequenceMatcher(None, old_words, new_words)
    parts = []
    for op, i1, i2, j1, j2 in matcher.get_opcodes():
        if op == "equal":
            parts.append(html_module.escape(" ".join(old_words[i1:i2])))
        elif op == "delete":
            parts.append(f'<span class="diff-del">{html_module.escape(" ".join(old_words[i1:i2]))}</span>')
        elif op == "insert":
            parts.append(f'<span class="diff-ins">{html_module.escape(" ".join(new_words[j1:j2]))}</span>')
        elif op == "replace":
            parts.append(f'<span class="diff-del">{html_module.escape(" ".join(old_words[i1:i2]))}</span>')
            parts.append(f'<span class="diff-ins">{html_module.escape(" ".join(new_words[j1:j2]))}</span>')
    return " ".join(parts)


def _format_no_previous(text: str) -> str:
    return (
        '<p class="diff-info">Keine Vorversion gefunden — '
        'dies ist möglicherweise die Erstfassung.</p>'
        f'<div class="diff-current">{html_module.escape(text)}</div>'
    )


def _error_result(msg: str) -> dict:
    return {
        "current": None, "previous": None,
        "diff_html": f'<p class="diff-info">{html_module.escape(msg)}</p>',
        "has_changes": False,
    }


# ── Helpers ──

def _day_before(date_str: str) -> str | None:
    if not date_str:
        return None
    date_str = date_str.strip()
    for fmt in ("%d.%m.%Y", "%Y-%m-%d", "%Y-%m-%dT%H:%M:%S"):
        try:
            dt = datetime.strptime(date_str.split("+")[0].split(".000")[0], fmt)
            return (dt - timedelta(days=1)).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


def _clean_html(text: str) -> str:
    clean = re.sub(r'<(script|style|noscript)[^>]*>.*?</\1>', '', text, flags=re.DOTALL | re.IGNORECASE)
    clean = re.sub(r'<(?:br|/p|/div|/tr|/li)\s*/?>', '\n', clean, flags=re.IGNORECASE)
    clean = re.sub(r'<[^>]+>', ' ', clean)
    clean = html_module.unescape(clean)
    clean = re.sub(r'[ \t]+', ' ', clean)
    clean = re.sub(r'\n[ \t]+', '\n', clean)
    clean = re.sub(r'\n{3,}', '\n\n', clean)
    return clean.strip()
