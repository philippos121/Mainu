"""Service for fetching and comparing versions of RIS Bundesrecht provisions.

Working approach:
1. Query RIS API with Gesetzesnummer + ArtikelParagraphAnlage → get ContentUrls
2. Query RIS API with same + Fassung.FassungVom → get ContentUrls for OLD version
3. Fetch HTML content from both ContentUrls (these ARE version-specific!)
4. Compare text content.

Key insight: The BrKons API returns the same consolidated NOR number for all
FassungVom queries, BUT the ContentUrls in Dokumentliste are version-specific.
Also: FassungVom on Dokument.wxe URLs is IGNORED when a specific NOR is given.
So we must use the API ContentUrls, not the website, for version comparison.
"""

import difflib
import html as html_module
import logging
import re
from datetime import datetime, timedelta

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "de-AT,de;q=0.9,en;q=0.5",
}

BASE_URL = settings.RIS_API_BASE_URL


async def fetch_provision_diff(
    doc_id: str,
    gesetzesnummer: str,
    artikel: str,
    inkrafttreten: str,
) -> dict:
    """Fetch current + previous version and return diff."""
    logger.info(f"=== DIFF: NOR={doc_id}, GesNr={gesetzesnummer}, Art={artikel}, Inkraft={inkrafttreten}")

    if not gesetzesnummer or not artikel:
        return _error_result("Gesetzesnummer und Artikel fehlen.")

    # 1. Get CURRENT version text via API ContentUrl
    current_result = await _fetch_version_text(gesetzesnummer, artikel, fassung_vom=None)
    if not current_result or not current_result["text"]:
        return _error_result("Aktueller Text konnte nicht geladen werden.")

    # 2. Compute FassungVom
    fassung_vom = _day_before(inkrafttreten)
    if not fassung_vom:
        return {
            "current": {"text": current_result["text"], "date": inkrafttreten},
            "previous": None,
            "diff_html": _no_previous("Inkrafttretensdatum nicht parsbar.", current_result["text"]),
            "has_changes": False,
        }

    # 3. Get PREVIOUS version text via API ContentUrl with FassungVom
    prev_result = await _fetch_version_text(gesetzesnummer, artikel, fassung_vom=fassung_vom)

    if not prev_result or not prev_result["text"]:
        return {
            "current": {"text": current_result["text"], "date": inkrafttreten,
                        "info": current_result.get("bgbl", "")},
            "previous": None,
            "diff_html": _no_previous(f"Keine Fassung vom {fassung_vom} verfügbar.", current_result["text"]),
            "has_changes": False,
        }

    # 4. Compare
    cur_text = current_result["text"]
    prev_text = prev_result["text"]

    if cur_text.strip() == prev_text.strip():
        return {
            "current": {"text": cur_text, "date": inkrafttreten, "info": current_result.get("bgbl", "")},
            "previous": None,
            "diff_html": (
                f'<p class="diff-info">Kein Textunterschied zur Fassung vom {fassung_vom}. '
                f'RIS-Metadaten-Update ohne inhaltliche Änderung.</p>'
                f'<div class="diff-current">{html_module.escape(cur_text)}</div>'
            ),
            "has_changes": False,
        }

    # Real change!
    diff_html = _compute_word_diff(prev_text, cur_text)
    return {
        "current": {"text": cur_text, "date": inkrafttreten, "info": current_result.get("bgbl", "")},
        "previous": {"text": prev_text, "date": prev_result.get("inkrafttreten", f"Fassung vom {fassung_vom}"),
                      "info": prev_result.get("bgbl", "")},
        "diff_html": diff_html,
        "has_changes": True,
    }


async def debug_document(gesetzesnummer: str, artikel: str) -> dict:
    """DEBUG: show API responses and ContentUrls."""
    result = {}

    # Current
    cur = await _query_api(gesetzesnummer, artikel, fassung_vom=None)
    if cur:
        refs = _extract_refs(cur)
        result["current_hits"] = len(refs)
        if refs:
            d = refs[0].get("Data", {})
            m = _flatten_meta(d)
            result["current_meta"] = {k: str(v)[:200] for k, v in m.items()}
            urls = _find_content_urls(d)
            result["current_content_urls"] = urls

    # Previous (Inkraft - 1 day from first result)
    if cur:
        refs = _extract_refs(cur)
        if refs:
            m = _flatten_meta(refs[0].get("Data", {}))
            inkraft = m.get("Inkrafttretensdatum", "")
            fv = _day_before(inkraft) if inkraft else None
            if fv:
                prev = await _query_api(gesetzesnummer, artikel, fassung_vom=fv)
                if prev:
                    refs2 = _extract_refs(prev)
                    result["prev_fassung_vom"] = fv
                    result["prev_hits"] = len(refs2)
                    if refs2:
                        d2 = refs2[0].get("Data", {})
                        m2 = _flatten_meta(d2)
                        result["prev_meta"] = {k: str(v)[:200] for k, v in m2.items()}
                        urls2 = _find_content_urls(d2)
                        result["prev_content_urls"] = urls2
                        result["urls_differ"] = urls != urls2

    return result


# ── Core: fetch version text via API ContentUrl ──

async def _fetch_version_text(
    gesetzesnummer: str,
    artikel: str,
    fassung_vom: str | None,
) -> dict | None:
    """Query API, extract ContentUrl, fetch HTML content, extract text."""
    data = await _query_api(gesetzesnummer, artikel, fassung_vom)
    if not data:
        return None

    refs = _extract_refs(data)
    if not refs:
        return None

    ref = refs[0]
    d = ref.get("Data", {})
    m = _flatten_meta(d)

    # Find HTML ContentUrl
    content_urls = _find_content_urls(d)
    logger.info(f"ContentUrls (FassungVom={fassung_vom}): {content_urls}")

    html_url = None
    for url in content_urls:
        if "html" in url.lower() or "Html" in url:
            html_url = url
            break
    # Fallback: any content URL
    if not html_url and content_urls:
        html_url = content_urls[0]

    if not html_url:
        logger.warning("No ContentUrl found in API response")
        return None

    # Fetch the content
    text = await _fetch_html_text(html_url)
    if not text:
        return None

    return {
        "text": text,
        "bgbl": m.get("Kundmachungsorgan", ""),
        "inkrafttreten": m.get("Inkrafttretensdatum", ""),
    }


async def _query_api(gesetzesnummer: str, artikel: str, fassung_vom: str | None) -> dict | None:
    """Query the RIS OGD API."""
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
    logger.info(f"API: {params}")

    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            resp = await client.get(url, params=params)
            resp.raise_for_status()
            return resp.json()
        except Exception as e:
            logger.error(f"API error: {e}")
            return None


async def _fetch_html_text(url: str) -> str:
    """Fetch HTML from a ContentUrl and extract clean text."""
    logger.info(f"Fetching ContentUrl: {url}")
    async with httpx.AsyncClient(timeout=20.0, follow_redirects=True, headers=_HEADERS) as client:
        try:
            resp = await client.get(url)
            resp.raise_for_status()
            raw = resp.text
            text = _clean_html(raw)
            text = _remove_accessible_duplicates(text)
            logger.info(f"ContentUrl text: {len(text)} chars")
            return text
        except Exception as e:
            logger.error(f"ContentUrl fetch error: {e}")
            return ""


# ── Response parsing ──

def _extract_refs(data: dict) -> list[dict]:
    refs = data.get("OgdSearchResult", {}).get("OgdDocumentResults", {}).get("OgdDocumentReference", [])
    if isinstance(refs, dict):
        refs = [refs]
    return refs or []


def _flatten_meta(data_entry: dict) -> dict:
    metadata = data_entry.get("Metadaten", {})
    merged = {}
    for key in ("Technisch", "Allgemein", "Bundesrecht"):
        section = metadata.get(key)
        if isinstance(section, list) and section:
            section = section[0]
        if isinstance(section, dict):
            merged.update(section)
            for sub in ("BrKons", "LrKons"):
                s = section.get(sub)
                if isinstance(s, list) and s:
                    s = s[0]
                if isinstance(s, dict):
                    merged.update(s)
    return merged


def _find_content_urls(data_entry: dict) -> list[str]:
    """Recursively find all ContentUrl/Url values."""
    urls = []
    _walk(data_entry, urls, 0)
    return urls


def _walk(obj, urls, depth):
    if depth > 12:
        return
    if isinstance(obj, dict):
        # {DataType: "Html", Url: "https://..."}
        if "Url" in obj and "DataType" in obj:
            u = obj["Url"]
            if isinstance(u, str) and u.startswith("http"):
                urls.append(u)
        # ContentUrl can be string or list
        if "ContentUrl" in obj:
            v = obj["ContentUrl"]
            if isinstance(v, str) and v.startswith("http"):
                urls.append(v)
            elif isinstance(v, list):
                for item in v:
                    if isinstance(item, dict) and "Url" in item:
                        urls.append(item["Url"])
                    elif isinstance(item, str) and item.startswith("http"):
                        urls.append(item)
        for val in obj.values():
            _walk(val, urls, depth + 1)
    elif isinstance(obj, list):
        for item in obj:
            _walk(item, urls, depth + 1)


# ── Text processing ──

def _remove_accessible_duplicates(text: str) -> str:
    text = re.sub(r'(§\s*\d+[a-z]?\.?)\s*Paragraph\s*\d+[a-z]?,?\s*', r'\1 ', text)
    text = re.sub(
        r'(\(\d+[a-z]?\))\s*Absatz\s*(?:eins|zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn|\d+\s*[a-z]?),?\s*',
        r'\1 ', text)
    text = re.sub(r'Anmerkung,?\s*aus Bundesgesetzblatt[^)]*\)\s*', '', text)
    text = re.sub(r'\bParagraph\s+\d+\s*[a-z]?,\s*', '', text)
    text = re.sub(r'\bAbsatz\s+\d+\s*[a-z]?,\s*', '', text)
    text = re.sub(r'\bZiffer\s+(?:eins|zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn|\d+)\s*', '', text)
    text = re.sub(r'\bLitera\s+[a-z]\s*', '', text)
    text = re.sub(r'\bArtikel\s+(?:römisch\s+)?\d+,?\s*', '', text)
    text = re.sub(r'  +', ' ', text)
    return text.strip()


def _compute_word_diff(old_text: str, new_text: str) -> str:
    old_words = old_text.split()
    new_words = new_text.split()
    if not old_words and not new_words:
        return '<p class="diff-info">Beide Versionen sind leer.</p>'
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


def _no_previous(msg: str, text: str) -> str:
    return (f'<p class="diff-info">{html_module.escape(msg)}</p>'
            f'<div class="diff-current">{html_module.escape(text)}</div>')


def _error_result(msg: str) -> dict:
    return {"current": None, "previous": None,
            "diff_html": f'<p class="diff-info">{html_module.escape(msg)}</p>',
            "has_changes": False}


def _day_before(date_str: str) -> str | None:
    if not date_str:
        return None
    for fmt in ("%d.%m.%Y", "%Y-%m-%d", "%Y-%m-%dT%H:%M:%S"):
        try:
            dt = datetime.strptime(date_str.strip().split("+")[0].split(".000")[0], fmt)
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
