"""Service for fetching and comparing versions of RIS Bundesrecht provisions.

Correct approach (validated against API docs):

1. Query API: Gesetzesnummer + ArtikelParagraphAnlage → get current NOR number
2. Query API: same + Fassung.FassungVom=(Inkrafttreten - 1 day) → get PREVIOUS NOR number
3. If NOR numbers differ → real change. Fetch text for each NOR from website.
4. If NOR numbers same → metadata-only update.
5. Compute word-level diff.

Text comes from the RIS website (ris.bka.gv.at/Dokument.wxe) because:
- The API JSON does NOT contain document text, only metadata + ContentUrls
- ContentUrls may not respect FassungVom (always serve current version)
- Each NOR number has its own website page with the correct version text
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

BASE_URL = settings.RIS_API_BASE_URL


# ── Public API ──

async def fetch_provision_diff(
    gesetzesnummer: str,
    artikel: str,
    inkrafttreten: str,
) -> dict:
    """Fetch current + previous version of a provision and return diff."""
    logger.info(f"=== DIFF START: GesNr={gesetzesnummer}, Art={artikel}, Inkraft={inkrafttreten}")

    # 1. Get current version NOR number from API
    current_meta = await _get_version_metadata(gesetzesnummer, artikel, fassung_vom=None)
    if not current_meta:
        return _error_result("Aktuelle Version konnte nicht via API gefunden werden.")

    current_nor = current_meta.get("nor_id", "")
    logger.info(f"Current version: NOR={current_nor}, Inkraft={current_meta.get('inkrafttreten')}")

    # 2. Find a FassungVom date that yields a DIFFERENT NOR number.
    #    The current version's Inkrafttretensdatum tells us when it took effect.
    #    But ImRisSeit may also surface metadata-only updates where Inkrafttreten is old.
    #    Strategy: try multiple dates going backwards until we find a different NOR.
    inkraft = current_meta.get("inkrafttreten", "")
    candidate_dates = []

    # First candidate: Inkrafttretensdatum - 1 day (if the provision actually changed)
    d = _day_before(inkrafttreten) or _day_before(inkraft)
    if d:
        candidate_dates.append(d)

    # More candidates: yesterday, 1 week ago, 1 month ago, 6 months ago, 1 year ago
    now = datetime.now()
    for delta_days in [1, 7, 30, 180, 365]:
        cd = (now - timedelta(days=delta_days)).strftime("%Y-%m-%d")
        if cd not in candidate_dates:
            candidate_dates.append(cd)

    logger.info(f"Candidate FassungVom dates: {candidate_dates}")

    # 3. Try each date until we find a different NOR number
    prev_meta = None
    prev_nor = ""
    used_fassung_vom = ""
    for fassung_vom in candidate_dates:
        logger.info(f"Trying FassungVom={fassung_vom}...")
        meta = await _get_version_metadata(gesetzesnummer, artikel, fassung_vom=fassung_vom)
        if meta and meta.get("nor_id") and meta["nor_id"] != current_nor:
            prev_meta = meta
            prev_nor = meta["nor_id"]
            used_fassung_vom = fassung_vom
            logger.info(f"Found different NOR! FassungVom={fassung_vom} → NOR={prev_nor}")
            break
        elif meta:
            logger.info(f"FassungVom={fassung_vom} → same NOR={meta.get('nor_id')}")

    logger.info(f"Previous version result: NOR={prev_nor or 'none found'}")

    # 4. Compare NOR numbers
    if not prev_nor:
        # Same document → metadata-only update or no previous version
        current_text = await _fetch_text_for_nor(current_nor)
        msg = (
            f"Alle geprüften Fassungsdaten ({', '.join(candidate_dates[:3])}...) "
            f"ergeben dieselbe Dokumentnummer ({current_nor}). "
            "Entweder ist dies die Erstfassung oder ein reines RIS-Metadaten-Update."
        )
        return {
            "current": {
                "text": current_text or "",
                "info": current_meta.get("bgbl", ""),
                "date": current_meta.get("inkrafttreten", ""),
                "nor_id": current_nor,
            },
            "previous": None,
            "diff_html": f'<p class="diff-info">{msg}</p>'
                         + (f'<div class="diff-current">{html_module.escape(current_text)}</div>' if current_text else ""),
            "has_changes": False,
        }

    # 5. Different NOR numbers → real change! Fetch text for both from website.
    logger.info(f"Different NOR IDs! Current={current_nor}, Previous={prev_nor}")
    current_text = await _fetch_text_for_nor(current_nor)
    prev_text = await _fetch_text_for_nor(prev_nor)

    if not current_text:
        return _error_result(f"Text für aktuelle Version ({current_nor}) konnte nicht geladen werden.")
    if not prev_text:
        return _error_result(f"Text für Vorversion ({prev_nor}) konnte nicht geladen werden.")

    # 6. Compute diff
    if current_text.strip() == prev_text.strip():
        diff_html = (
            '<p class="diff-info">Beide Fassungen haben identischen Text trotz '
            f'unterschiedlicher Dokumentnummern ({current_nor} vs {prev_nor}).</p>'
            f'<div class="diff-current">{html_module.escape(current_text)}</div>'
        )
        has_changes = False
    else:
        diff_html = _compute_word_diff(prev_text, current_text)
        has_changes = True

    return {
        "current": {
            "text": current_text,
            "info": current_meta.get("bgbl", ""),
            "date": current_meta.get("inkrafttreten", ""),
            "nor_id": current_nor,
        },
        "previous": {
            "text": prev_text,
            "info": prev_meta.get("bgbl", ""),
            "date": prev_meta.get("inkrafttreten", ""),
            "nor_id": prev_nor,
        },
        "diff_html": diff_html,
        "has_changes": has_changes,
    }


async def debug_document(gesetzesnummer: str, artikel: str) -> dict:
    """DEBUG: show what the API returns across multiple dates."""
    result = {}
    now = datetime.now()

    # Current version
    current = await _get_version_metadata(gesetzesnummer, artikel, fassung_vom=None)
    result["current"] = current
    current_nor = (current or {}).get("nor_id", "")

    # Try multiple dates and show NOR for each
    versions = {}
    for label, delta in [("yesterday", 1), ("1_week", 7), ("1_month", 30),
                         ("3_months", 90), ("6_months", 180), ("1_year", 365),
                         ("2_years", 730)]:
        fv = (now - timedelta(days=delta)).strftime("%Y-%m-%d")
        meta = await _get_version_metadata(gesetzesnummer, artikel, fassung_vom=fv)
        nor = (meta or {}).get("nor_id", "")
        versions[label] = {
            "fassung_vom": fv,
            "nor_id": nor,
            "inkrafttreten": (meta or {}).get("inkrafttreten", ""),
            "differs_from_current": nor != current_nor and nor != "",
        }

    result["versions"] = versions

    # Fetch text for current NOR
    if current_nor:
        text = await _fetch_text_for_nor(current_nor)
        result["current_text_length"] = len(text) if text else 0
        result["current_text_preview"] = (text[:300] + "...") if text and len(text) > 300 else text

    # Fetch text for first differing NOR
    for v in versions.values():
        if v["differs_from_current"] and v["nor_id"]:
            prev_text = await _fetch_text_for_nor(v["nor_id"])
            result["prev_nor_id"] = v["nor_id"]
            result["prev_text_length"] = len(prev_text) if prev_text else 0
            result["prev_text_preview"] = (prev_text[:300] + "...") if prev_text and len(prev_text) > 300 else prev_text
            break

    return result


# ── API version metadata ──

async def _get_version_metadata(
    gesetzesnummer: str,
    artikel: str,
    fassung_vom: str | None,
) -> dict | None:
    """Query the RIS API and extract the NOR number + metadata for a version."""
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
    logger.info(f"API query: {url} params={params}")

    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            resp = await client.get(url, params=params)
            resp.raise_for_status()
            data = resp.json()
        except Exception as e:
            logger.error(f"API error: {e}")
            return None

    refs = _extract_refs(data)
    hits = _extract_hits(data)
    logger.info(f"API response: {hits} hits, {len(refs)} refs")

    if not refs:
        return None

    ref = refs[0]
    data_entry = ref.get("Data", {})
    m = _flatten_metadata(data_entry)

    nor_id = (
        _s(m.get("ID"))
        or _s(m.get("Dokumentnummer"))
        or _s(data_entry.get("Dokumentnummer"))
        or ""
    )
    inkrafttreten = _s(m.get("Inkrafttretensdatum")) or ""
    bgbl = _s(m.get("Kundmachungsorgan")) or _s(m.get("Aenderung")) or ""

    # Also extract ContentUrls for logging
    content_urls = _extract_content_urls(data_entry)

    logger.info(f"Extracted: NOR={nor_id}, Inkraft={inkrafttreten}, BGBl={bgbl}, ContentUrls={len(content_urls)}")

    return {
        "nor_id": nor_id,
        "inkrafttreten": inkrafttreten,
        "bgbl": bgbl,
        "content_urls": content_urls,
    }


# ── Text fetching from RIS website ──

async def _fetch_text_for_nor(nor_id: str) -> str:
    """Fetch legal text for a specific NOR document from the RIS website."""
    if not nor_id:
        return ""

    url = f"https://www.ris.bka.gv.at/Dokument.wxe?Abfrage=Bundesnormen&Dokumentnummer={nor_id}"
    logger.info(f"Fetching website text: {url}")

    async with httpx.AsyncClient(timeout=25.0, follow_redirects=True, headers=_BROWSER_HEADERS) as client:
        try:
            resp = await client.get(url)
            resp.raise_for_status()
            text = _extract_text_from_page(resp.text)
            text = _remove_accessible_duplicates(text)
            logger.info(f"Website text for {nor_id}: {len(text)} chars")
            return text
        except Exception as e:
            logger.error(f"Website fetch error for {nor_id}: {e}")
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
    hits = data.get("OgdSearchResult", {}).get("OgdDocumentResults", {}).get("Hits", {})
    if isinstance(hits, dict):
        text = hits.get("#text", "0")
    else:
        text = str(hits)
    try:
        return int(text)
    except (ValueError, TypeError):
        return 0


def _flatten_metadata(data_entry: dict) -> dict:
    metadata = data_entry.get("Metadaten", {})
    merged = {}
    for key in ("Technisch", "Allgemein", "Bundesrecht"):
        section = metadata.get(key)
        if isinstance(section, list) and section:
            section = section[0]
        if isinstance(section, dict):
            merged.update(section)
            for sub_key in ("BrKons", "LrKons"):
                sub = section.get(sub_key)
                if isinstance(sub, list) and sub:
                    sub = sub[0]
                if isinstance(sub, dict):
                    merged.update(sub)
    return merged


def _extract_content_urls(data_entry: dict) -> list[str]:
    urls = []
    _walk_urls(data_entry, urls, 0)
    return urls


def _walk_urls(obj, urls, depth):
    if depth > 10:
        return
    if isinstance(obj, dict):
        if "Url" in obj and isinstance(obj["Url"], str) and obj["Url"].startswith("http"):
            urls.append(obj["Url"])
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
            _walk_urls(v, urls, depth + 1)
    elif isinstance(obj, list):
        for item in obj:
            _walk_urls(item, urls, depth + 1)


def _s(val) -> str:
    if val is None:
        return ""
    if isinstance(val, str):
        return val
    if isinstance(val, list):
        return ", ".join(str(v) for v in val)
    return str(val)


# ── Website text extraction ──

def _extract_text_from_page(page_html: str) -> str:
    if not page_html or len(page_html) < 200:
        return ""

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

    blocks = re.findall(r'<(?:td|div)[^>]*>(.*?)</(?:td|div)>', page_html, re.DOTALL)
    best = ""
    for block in blocks:
        cleaned = _clean_html(block)
        if len(cleaned) > len(best) and len(cleaned) > 100:
            if re.search(r'\(\d+\)|§\s*\d+|Abs\.|Absatz', cleaned):
                best = cleaned
    return best


def _remove_accessible_duplicates(text: str) -> str:
    text = re.sub(r'(§\s*\d+[a-z]?\.?)\s*Paragraph\s*\d+[a-z]?,?\s*', r'\1 ', text)
    text = re.sub(
        r'(\(\d+\))\s*Absatz\s*(?:eins|zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn|\d+),?\s*',
        r'\1 ', text)
    text = re.sub(r'Anmerkung,\s*aus Bundesgesetzblatt[^)]*\)\s*', '', text)
    text = re.sub(r'\bParagraph\s+\d+,\s*', '', text)
    text = re.sub(r'(§§?\s*\d+[^)]*)\s*Paragraphen\s*\d+[^)]*', r'\1', text)
    text = re.sub(r'  +', ' ', text)
    return text.strip()


# ── Diff computation ──

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
        '<p class="diff-info">Keine Vorversion gefunden.</p>'
        f'<div class="diff-current">{html_module.escape(text)}</div>'
    )


def _format_no_date() -> str:
    return '<p class="diff-info">Inkrafttretensdatum konnte nicht bestimmt werden — Vergleich nicht möglich.</p>'


def _error_result(msg: str) -> dict:
    return {
        "current": None, "previous": None,
        "diff_html": f'<p class="diff-info">{html_module.escape(msg)}</p>',
        "has_changes": False,
    }


def _text_only_result(nor_id: str, meta: dict) -> dict:
    return {
        "current": {
            "text": "",
            "info": meta.get("bgbl", ""),
            "date": meta.get("inkrafttreten", ""),
            "nor_id": nor_id,
        },
        "previous": None,
    }


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
