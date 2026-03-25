"""Service for fetching and comparing versions of RIS Bundesrecht provisions.

Strategy:
1. Fetch the NOR document page from the RIS website (most reliable source
   of full text).
2. Extract metadata (Gesetzesnummer, ArtikelParagraphAnlage, Inkrafttretensdatum)
   from the OGD API.
3. Find previous version via FassungVom = day before current Inkrafttretensdatum.
4. Compute word-level diff.
"""

import difflib
import html as html_module
import json
import logging
import re
from datetime import timedelta

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

# Realistic browser headers to avoid being blocked
_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "de-AT,de;q=0.9,en;q=0.5",
}


async def debug_document(doc_id: str) -> dict:
    """DEBUG endpoint: return raw data from both API and website for a document."""
    result = {}

    # 1. OGD API response
    params = {
        "Applikation": "BrKons",
        "Dokumentnummer": doc_id,
        "DokumenteProSeite": "One",
    }
    url = f"{settings.RIS_API_BASE_URL}/Bundesrecht"
    api_data = await _fetch_ris(url, params)
    if api_data:
        refs = _extract_refs(api_data)
        if refs:
            ref = refs[0]
            data_entry = ref.get("Data", {})
            result["api_data_keys"] = list(data_entry.keys())
            result["api_metadaten_keys"] = list(data_entry.get("Metadaten", {}).keys())

            # Show full Metadaten structure (abbreviated)
            metadata = data_entry.get("Metadaten", {})
            flat = _collect_flat_metadata(metadata)
            result["api_flat_metadata"] = {k: str(v)[:200] for k, v in flat.items()}

            # Show Dokumentliste structure
            if "Dokumentliste" in data_entry:
                result["api_dokumentliste"] = _deep_summarize(data_entry["Dokumentliste"])

            # Show all other top-level Data fields (first 500 chars)
            for key in data_entry:
                if key not in ("Metadaten", "Dokumentliste"):
                    val = data_entry[key]
                    if isinstance(val, str):
                        result[f"api_data_{key}"] = val[:500]
                    else:
                        result[f"api_data_{key}"] = _deep_summarize(val)

            # Try content URL extraction
            content_urls = _extract_content_urls(data_entry)
            result["content_urls"] = content_urls

            # Fetch first content URL if available
            if content_urls:
                async with httpx.AsyncClient(timeout=15.0, follow_redirects=True, headers=_HEADERS) as client:
                    try:
                        resp = await client.get(content_urls[0])
                        result["content_url_status"] = resp.status_code
                        result["content_url_body_preview"] = resp.text[:1000]
                    except Exception as e:
                        result["content_url_error"] = str(e)
        else:
            result["api_error"] = "No OgdDocumentReference in response"
    else:
        result["api_error"] = "API request failed"

    # 2. RIS Website response
    ris_url = f"https://www.ris.bka.gv.at/Dokument.wxe?Abfrage=Bundesnormen&Dokumentnummer={doc_id}"
    async with httpx.AsyncClient(timeout=20.0, follow_redirects=True, headers=_HEADERS) as client:
        try:
            resp = await client.get(ris_url)
            result["website_status"] = resp.status_code
            result["website_url_final"] = str(resp.url)
            result["website_body_length"] = len(resp.text)
            result["website_body_preview"] = resp.text[:2000]

            # Try text extraction
            extracted = _extract_ris_page_text(resp.text)
            result["website_extracted_text"] = extracted[:1000] if extracted else "(empty)"
            result["website_extracted_length"] = len(extracted) if extracted else 0
        except Exception as e:
            result["website_error"] = str(e)

    return result


async def fetch_provision_diff(doc_id: str) -> dict:
    """Fetch current + previous version of a Bundesrecht provision, return diff."""

    # 1. Fetch metadata from OGD API
    meta = await _fetch_metadata(doc_id)
    if not meta:
        return _error_result("Dokument-Metadaten konnten nicht aus RIS geladen werden.")

    # 2. Fetch the text from the RIS website (most reliable)
    current_text = await _fetch_text_from_website(doc_id)
    if not current_text:
        return _error_result(
            "Dokumenttext konnte nicht von der RIS-Website geladen werden. "
            "Bitte versuchen Sie es später erneut."
        )

    # 3. Find the previous version
    prev_text = None
    prev_meta = None
    if meta.get("gesetzesnummer") and meta.get("artikel") and meta.get("inkrafttreten"):
        prev_result = await _fetch_previous_version(
            gesetzesnummer=meta["gesetzesnummer"],
            artikel=meta["artikel"],
            current_inkrafttreten=meta["inkrafttreten"],
            current_doc_id=doc_id,
        )
        if prev_result:
            prev_text = prev_result.get("text")
            prev_meta = prev_result

    # 4. Compute diff
    if prev_text:
        diff_html = _compute_word_diff(prev_text, current_text)
        has_changes = prev_text.strip() != current_text.strip()
    else:
        diff_html = _format_no_previous(current_text)
        has_changes = False

    return {
        "current": {
            "text": current_text,
            "info": meta.get("bgbl", ""),
            "date": meta.get("inkrafttreten", ""),
        },
        "previous": {
            "text": prev_text,
            "info": prev_meta.get("bgbl", "") if prev_meta else "",
            "date": prev_meta.get("inkrafttreten", "") if prev_meta else "",
        } if prev_text else None,
        "diff_html": diff_html,
        "has_changes": has_changes,
    }


def _error_result(msg: str) -> dict:
    return {
        "current": None,
        "previous": None,
        "diff_html": f'<p class="diff-info">{html_module.escape(msg)}</p>',
        "has_changes": False,
    }


# ── Metadata from OGD API ──

async def _fetch_metadata(doc_id: str) -> dict | None:
    """Fetch document metadata from the RIS OGD API."""
    params = {
        "Applikation": "BrKons",
        "Dokumentnummer": doc_id,
        "DokumenteProSeite": "One",
    }
    url = f"{settings.RIS_API_BASE_URL}/Bundesrecht"
    data = await _fetch_ris(url, params)
    if not data:
        return None

    refs = _extract_refs(data)
    if not refs:
        return None

    ref = refs[0]
    data_entry = ref.get("Data", {})
    metadata = data_entry.get("Metadaten", {})
    m = _collect_flat_metadata(metadata)

    return {
        "gesetzesnummer": _s(m.get("Gesetzesnummer")) or _s(data_entry.get("Gesetzesnummer")) or "",
        "artikel": _s(m.get("ArtikelParagraphAnlage")) or _s(data_entry.get("ArtikelParagraphAnlage")) or "",
        "inkrafttreten": _s(m.get("Inkrafttretensdatum")) or _s(data_entry.get("Inkrafttretensdatum")) or "",
        "bgbl": _s(m.get("Kundmachungsorgan")) or _s(m.get("Aenderung")) or "",
    }


# ── Text from RIS Website (primary strategy) ──

async def _fetch_text_from_website(doc_id: str) -> str:
    """Fetch the legal text from the RIS website HTML page."""
    ris_url = f"https://www.ris.bka.gv.at/Dokument.wxe?Abfrage=Bundesnormen&Dokumentnummer={doc_id}"
    logger.info(f"Fetching text from RIS website: {ris_url}")

    async with httpx.AsyncClient(timeout=25.0, follow_redirects=True, headers=_HEADERS) as client:
        try:
            resp = await client.get(ris_url)
            resp.raise_for_status()
            page_html = resp.text
            logger.info(f"RIS website response: status={resp.status_code}, length={len(page_html)}")

            text = _extract_ris_page_text(page_html)
            if text:
                logger.info(f"Extracted text length: {len(text)}")
                return text

            logger.warning(f"Could not extract text from RIS page for {doc_id}")
            return ""
        except Exception as e:
            logger.error(f"Failed to fetch RIS website for {doc_id}: {e}")
            return ""


def _extract_ris_page_text(page_html: str) -> str:
    """Extract the legal text from a RIS Bundesrecht HTML page.

    The RIS website structure typically has:
    - Table rows with headers like "Text", "Beachte", etc.
    - The text content is in <td> or <div> elements following the "Text" header
    """
    if not page_html or len(page_html) < 100:
        return ""

    # Strategy 1: Find content between "Text" label and next section label
    # RIS uses <td> with class "Titel" containing "Text", followed by content <td>
    # Pattern: look for >Text< followed by content until next section
    section_labels = [
        "Schlagworte", "Zuletzt aktualisiert", "Gesetzesnummer",
        "Dokumentnummer", "European Legislation Identifier",
        "Beachte", "Anmerkung", "Navigation im Suchergebnis",
    ]
    end_pattern = "|".join(re.escape(label) for label in section_labels)

    # Try finding "Text" as a section header, then grab everything until next section
    # Pattern: >Text</...> ... content ... <next section>
    patterns = [
        # Table-based layout: <td>Text</td> ... content ... <td>NextSection</td>
        rf'>\s*Text\s*</(?:td|th|div|h\d|span)[^>]*>(.*?)(?:{end_pattern})',
        # Heading-based: <h2>Text</h2> content
        rf'<h[23][^>]*>\s*Text\s*</h[23]>(.*?)(?:<h[23]|{end_pattern})',
        # Class-based: class="..Text.." or id containing Text
        rf'class="[^"]*Titel[^"]*"[^>]*>\s*Text\s*<.*?</(?:td|div)>(.*?)(?:{end_pattern})',
    ]

    for pattern in patterns:
        match = re.search(pattern, page_html, re.DOTALL | re.IGNORECASE)
        if match:
            extracted = _clean_html(match.group(1))
            if extracted and len(extracted.strip()) > 20:
                logger.info(f"Text extracted with pattern: {pattern[:50]}...")
                return extracted.strip()

    # Strategy 2: Look for the largest block of continuous text in the page
    # (excluding navigation, headers, footers)
    # Find all <td> or <div> elements with substantial text content
    blocks = re.findall(r'<(?:td|div)[^>]*>(.*?)</(?:td|div)>', page_html, re.DOTALL)
    best_block = ""
    for block in blocks:
        cleaned = _clean_html(block)
        # Legal text typically contains paragraphs with (1), (2) etc.
        if len(cleaned) > len(best_block) and len(cleaned) > 100:
            # Check if it looks like legal text (has paragraph numbers or § references)
            if re.search(r'\(\d+\)|§\s*\d+|Abs\.|Art\.|Gesetz', cleaned):
                best_block = cleaned

    if best_block:
        logger.info(f"Text extracted via largest legal text block: {len(best_block)} chars")
        return best_block.strip()

    # Strategy 3: Just grab everything between <body> tags, clean it,
    # and look for the legal text portion
    body_match = re.search(r'<body[^>]*>(.*?)</body>', page_html, re.DOTALL | re.IGNORECASE)
    if body_match:
        body_text = _clean_html(body_match.group(1))
        # Find the "Text" section marker and grab text after it
        text_idx = body_text.find("Text\n")
        if text_idx == -1:
            text_idx = body_text.find("Text ")
        if text_idx > 0:
            after_text = body_text[text_idx + 5:]
            # Cut at next known section
            for label in section_labels:
                cut_idx = after_text.find(label)
                if cut_idx > 0:
                    after_text = after_text[:cut_idx]
                    break
            if len(after_text.strip()) > 20:
                logger.info(f"Text extracted from body via 'Text' marker: {len(after_text)} chars")
                return after_text.strip()

    return ""


# ── Previous version ──

async def _fetch_previous_version(
    gesetzesnummer: str,
    artikel: str,
    current_inkrafttreten: str,
    current_doc_id: str,
) -> dict | None:
    """Find and fetch the version of the same provision valid before the current one."""
    fassung_vom = _day_before(current_inkrafttreten)
    if not fassung_vom:
        logger.warning(f"Cannot parse Inkrafttretensdatum: {current_inkrafttreten}")
        return None

    params = {
        "Applikation": "BrKons",
        "Gesetzesnummer": gesetzesnummer,
        "ArtikelParagraphAnlage": artikel,
        "FassungVom": fassung_vom,
        "DokumenteProSeite": "One",
    }
    url = f"{settings.RIS_API_BASE_URL}/Bundesrecht"

    logger.info(f"Fetching previous version: GesNr={gesetzesnummer}, Art={artikel}, FassungVom={fassung_vom}")
    data = await _fetch_ris(url, params)
    if not data:
        return None

    refs = _extract_refs(data)
    if not refs:
        logger.info("No previous version found via FassungVom")
        return None

    ref = refs[0]
    data_entry = ref.get("Data", {})
    metadata = data_entry.get("Metadaten", {})
    m = _collect_flat_metadata(metadata)

    prev_id = (
        _s(m.get("ID"))
        or _s(m.get("Dokumentnummer"))
        or _s(data_entry.get("Dokumentnummer"))
        or ""
    )

    if prev_id == current_doc_id:
        logger.info(f"Previous version is same document ({prev_id}), no actual change")
        return None

    if not prev_id:
        return None

    # Fetch text for previous version from website too
    prev_text = await _fetch_text_from_website(prev_id)
    if not prev_text:
        return None

    return {
        "text": prev_text,
        "inkrafttreten": _s(m.get("Inkrafttretensdatum")) or "",
        "bgbl": _s(m.get("Kundmachungsorgan")) or _s(m.get("Aenderung")) or "",
        "doc_id": prev_id,
    }


# ── Diff computation ──

def _compute_word_diff(old_text: str, new_text: str) -> str:
    """Compute a word-level diff and return styled HTML."""
    old_words = old_text.split()
    new_words = new_text.split()

    if not old_words and not new_words:
        return "<p class='diff-info'>Beide Versionen sind leer.</p>"

    matcher = difflib.SequenceMatcher(None, old_words, new_words)
    parts: list[str] = []

    for op, i1, i2, j1, j2 in matcher.get_opcodes():
        if op == "equal":
            parts.append(html_module.escape(" ".join(old_words[i1:i2])))
        elif op == "delete":
            deleted = html_module.escape(" ".join(old_words[i1:i2]))
            parts.append(f'<span class="diff-del">{deleted}</span>')
        elif op == "insert":
            inserted = html_module.escape(" ".join(new_words[j1:j2]))
            parts.append(f'<span class="diff-ins">{inserted}</span>')
        elif op == "replace":
            deleted = html_module.escape(" ".join(old_words[i1:i2]))
            inserted = html_module.escape(" ".join(new_words[j1:j2]))
            parts.append(f'<span class="diff-del">{deleted}</span>')
            parts.append(f'<span class="diff-ins">{inserted}</span>')

    return " ".join(parts)


def _format_no_previous(text: str) -> str:
    escaped = html_module.escape(text)
    return (
        '<p class="diff-info">Keine Vorversion gefunden — '
        'dies ist möglicherweise die Erstfassung oder es wurde nur '
        'ein RIS-Metadaten-Update durchgeführt (keine inhaltliche Änderung).</p>'
        f'<div class="diff-current">{escaped}</div>'
    )


# ── Content URL extraction (secondary strategy) ──

def _extract_content_urls(data_entry: dict) -> list[str]:
    """Extract ContentUrls from Dokumentliste."""
    urls = []
    _walk_for_content_urls(data_entry, urls, depth=0)
    return urls


def _walk_for_content_urls(obj, urls: list, depth: int):
    """Recursively walk structure to find ContentUrl fields."""
    if depth > 8:
        return
    if isinstance(obj, dict):
        if "ContentUrl" in obj:
            val = obj["ContentUrl"]
            if isinstance(val, str) and val.startswith("http"):
                urls.append(val)
        for v in obj.values():
            _walk_for_content_urls(v, urls, depth + 1)
    elif isinstance(obj, list):
        for item in obj:
            _walk_for_content_urls(item, urls, depth + 1)


# ── Helpers ──

def _clean_html(text: str) -> str:
    """Strip HTML tags and normalize whitespace."""
    clean = re.sub(r'<(script|style|noscript)[^>]*>.*?</\1>', '', text, flags=re.DOTALL | re.IGNORECASE)
    clean = re.sub(r'<(?:br|/p|/div|/tr|/li)\s*/?>', '\n', clean, flags=re.IGNORECASE)
    clean = re.sub(r'<[^>]+>', ' ', clean)
    clean = html_module.unescape(clean)
    clean = re.sub(r'[ \t]+', ' ', clean)
    clean = re.sub(r'\n[ \t]+', '\n', clean)
    clean = re.sub(r'\n{3,}', '\n\n', clean)
    return clean.strip()


def _day_before(date_str: str) -> str | None:
    if not date_str:
        return None
    import datetime as dt
    for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%d", "%d.%m.%Y"):
        try:
            parsed = dt.datetime.strptime(date_str.split("+")[0].split(".000")[0], fmt)
            prev = parsed - timedelta(days=1)
            return prev.strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


def _s(val) -> str:
    if val is None:
        return ""
    if isinstance(val, str):
        return val
    if isinstance(val, list):
        return ", ".join(str(v) for v in val)
    return str(val)


def _collect_flat_metadata(metadata: dict) -> dict:
    merged: dict = {}
    for key in ("Technisch", "Allgemein", "Bundesrecht", "BrKons"):
        section = metadata.get(key)
        if isinstance(section, list) and section and isinstance(section[0], dict):
            section = section[0]
        if isinstance(section, dict):
            merged.update(section)
            for subkey in ("BrKons", "LrKons"):
                sub = section.get(subkey)
                if isinstance(sub, list) and sub and isinstance(sub[0], dict):
                    sub = sub[0]
                if isinstance(sub, dict):
                    merged.update(sub)
    known = {"Kurztitel", "Langtitel", "Dokumentnummer", "Gesetzesnummer"}
    if not merged or not (known & set(merged.keys())):
        if known & set(metadata.keys()):
            merged.update(metadata)
    return merged


def _extract_refs(data: dict) -> list[dict]:
    refs = (
        data.get("OgdSearchResult", {})
        .get("OgdDocumentResults", {})
        .get("OgdDocumentReference", [])
    )
    if isinstance(refs, dict):
        refs = [refs]
    return refs or []


def _deep_summarize(obj, depth=0) -> str:
    """Summarize a nested structure for debug output."""
    if depth > 4:
        return "..."
    if isinstance(obj, dict):
        items = []
        for k in list(obj.keys())[:15]:
            items.append(f"{k}: {_deep_summarize(obj[k], depth + 1)}")
        return "{" + ", ".join(items) + "}"
    if isinstance(obj, list):
        if not obj:
            return "[]"
        return f"[{_deep_summarize(obj[0], depth + 1)} ...x{len(obj)}]"
    if isinstance(obj, str):
        return f'"{obj[:100]}"' if len(obj) > 100 else f'"{obj}"'
    return str(obj)


async def _fetch_ris(url: str, params: dict) -> dict | None:
    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            resp = await client.get(url, params=params)
            resp.raise_for_status()
            return resp.json()
        except (httpx.HTTPStatusError, httpx.RequestError) as e:
            logger.error(f"RIS API error: {e}")
            return None
