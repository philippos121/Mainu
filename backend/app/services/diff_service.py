"""Service for fetching and comparing versions of RIS Bundesrecht provisions.

Strategy:
1. Fetch the current NOR document via the OGD API to get metadata
   (Gesetzesnummer, ArtikelParagraphAnlage, Inkrafttretensdatum)
   AND the ContentUrl pointing to the actual document text.
2. Fetch the document text from the ContentUrl (HTML/XML).
3. Use Gesetzesnummer + ArtikelParagraphAnlage + FassungVom (one day before
   current Inkrafttretensdatum) to find the previous version.
4. Compute a word-level diff between old and new text.
"""

import difflib
import html as html_module
import logging
import re
from datetime import timedelta

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)


async def fetch_provision_diff(doc_id: str) -> dict:
    """Fetch current + previous version of a Bundesrecht provision, return diff."""

    # 1. Fetch the current document metadata + content
    current_doc = await _fetch_full_document(doc_id)
    if not current_doc or not current_doc.get("text"):
        return {
            "current": None,
            "previous": None,
            "diff_html": "<p class='diff-info'>Dokumenttext konnte nicht geladen werden. "
                         "Möglicherweise stellt die RIS-API keinen Volltext für dieses "
                         "Dokument bereit.</p>",
            "has_changes": False,
        }

    # 2. Find the previous version
    prev_doc = None
    if current_doc.get("gesetzesnummer") and current_doc.get("artikel"):
        prev_doc = await _fetch_previous_version(
            gesetzesnummer=current_doc["gesetzesnummer"],
            artikel=current_doc["artikel"],
            current_inkrafttreten=current_doc.get("inkrafttreten", ""),
            current_doc_id=doc_id,
        )

    # 3. Compute diff
    if prev_doc and prev_doc.get("text"):
        diff_html = _compute_word_diff(prev_doc["text"], current_doc["text"])
        has_changes = prev_doc["text"].strip() != current_doc["text"].strip()
    else:
        diff_html = _format_no_previous(current_doc["text"])
        has_changes = False

    return {
        "current": {
            "text": current_doc["text"],
            "info": current_doc.get("bgbl", ""),
            "date": current_doc.get("inkrafttreten", ""),
        },
        "previous": {
            "text": prev_doc["text"],
            "info": prev_doc.get("bgbl", ""),
            "date": prev_doc.get("inkrafttreten", ""),
        } if prev_doc and prev_doc.get("text") else None,
        "diff_html": diff_html,
        "has_changes": has_changes,
    }


async def _fetch_full_document(doc_id: str) -> dict | None:
    """Fetch a Bundesrecht document: metadata from API + text from ContentUrl."""
    params = {
        "Applikation": "BrKons",
        "Dokumentnummer": doc_id,
        "DokumenteProSeite": "One",
    }
    url = f"{settings.RIS_API_BASE_URL}/Bundesrecht"

    logger.info(f"Fetching document: {doc_id}")
    data = await _fetch_ris(url, params)
    if not data:
        return None

    refs = _extract_refs(data)
    if not refs:
        logger.warning(f"No document found for {doc_id}")
        return None

    ref = refs[0]
    data_entry = ref.get("Data", {})
    metadata = data_entry.get("Metadaten", {})
    m = _collect_flat_metadata(metadata)

    # Log the full structure for debugging
    logger.info(f"Document {doc_id} Data keys: {list(data_entry.keys())}")
    if "Dokumentliste" in data_entry:
        logger.info(f"Dokumentliste: {_summarize_structure(data_entry['Dokumentliste'])}")

    # Extract metadata
    gesetzesnummer = _s(m.get("Gesetzesnummer")) or _s(data_entry.get("Gesetzesnummer")) or ""
    artikel = _s(m.get("ArtikelParagraphAnlage")) or _s(data_entry.get("ArtikelParagraphAnlage")) or ""
    inkrafttreten = _s(m.get("Inkrafttretensdatum")) or _s(data_entry.get("Inkrafttretensdatum")) or ""
    bgbl = _s(m.get("Kundmachungsorgan")) or _s(m.get("Aenderung")) or ""

    # Try multiple strategies to get the text content
    text = ""

    # Strategy 1: Direct content fields in Data
    text = _try_direct_text(data_entry)

    # Strategy 2: ContentUrl from Dokumentliste
    if not text:
        content_urls = _extract_content_urls(data_entry)
        for content_url in content_urls:
            logger.info(f"Fetching content from: {content_url}")
            fetched = await _fetch_content_url(content_url)
            if fetched:
                text = fetched
                break

    # Strategy 3: Fetch directly from ris.bka.gv.at document page
    if not text:
        ris_url = f"https://www.ris.bka.gv.at/Dokument.wxe?Abfrage=Bundesnormen&Dokumentnummer={doc_id}"
        logger.info(f"Fetching from RIS website: {ris_url}")
        text = await _fetch_ris_website(ris_url)

    logger.info(f"Document {doc_id}: gesetzesnr={gesetzesnummer}, "
                f"artikel={artikel}, inkraft={inkrafttreten}, text_len={len(text)}")

    return {
        "text": text,
        "gesetzesnummer": gesetzesnummer,
        "artikel": artikel,
        "inkrafttreten": inkrafttreten,
        "bgbl": bgbl,
    }


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

    # Fetch previous version via FassungVom
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
        logger.info("No previous version found")
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

    # Check it's actually a different version
    if prev_id == current_doc_id:
        logger.info(f"Previous version is same document ({prev_id}), no actual change")
        return None

    # Fetch text for previous version too
    prev_full = await _fetch_full_document(prev_id) if prev_id else None
    if not prev_full or not prev_full.get("text"):
        return None

    return {
        "text": prev_full["text"],
        "inkrafttreten": _s(m.get("Inkrafttretensdatum")) or "",
        "bgbl": _s(m.get("Kundmachungsorgan")) or _s(m.get("Aenderung")) or "",
        "doc_id": prev_id,
    }


# ── Text extraction strategies ──

def _try_direct_text(data_entry: dict) -> str:
    """Try to extract text from direct fields in the API response."""
    for key in ("Dokumentinhalt", "Inhalt", "Text"):
        val = data_entry.get(key)
        if val and isinstance(val, str) and len(val.strip()) > 20:
            return _clean_html(val)
        if isinstance(val, dict):
            inner = val.get("#text", "")
            if inner and len(inner.strip()) > 20:
                return _clean_html(inner)
    return ""


def _extract_content_urls(data_entry: dict) -> list[str]:
    """Extract ContentUrls from the Dokumentliste section."""
    urls = []

    dok_liste = data_entry.get("Dokumentliste")
    if not dok_liste:
        return urls

    # Dokumentliste can be dict or list
    if isinstance(dok_liste, dict):
        dok_liste = [dok_liste]
    if not isinstance(dok_liste, list):
        return urls

    for entry in dok_liste:
        if not isinstance(entry, dict):
            continue

        # ContentReference can be nested
        content_refs = entry.get("ContentReference", [])
        if isinstance(content_refs, dict):
            content_refs = [content_refs]
        if not isinstance(content_refs, list):
            continue

        for cr in content_refs:
            if not isinstance(cr, dict):
                continue
            cr_urls = cr.get("Urls", {})
            if isinstance(cr_urls, dict):
                content_url = cr_urls.get("ContentUrl", "")
                if content_url:
                    urls.append(content_url)

    # Also check directly under Data
    if not urls:
        content_refs = data_entry.get("ContentReference", [])
        if isinstance(content_refs, dict):
            content_refs = [content_refs]
        if isinstance(content_refs, list):
            for cr in content_refs:
                if isinstance(cr, dict):
                    cr_urls = cr.get("Urls", {})
                    if isinstance(cr_urls, dict):
                        url = cr_urls.get("ContentUrl", "")
                        if url:
                            urls.append(url)

    return urls


async def _fetch_content_url(url: str) -> str:
    """Fetch document content from a RIS ContentUrl (HTML or XML)."""
    async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
        try:
            resp = await client.get(url)
            resp.raise_for_status()
            content = resp.text
            if not content or len(content.strip()) < 30:
                return ""
            return _clean_html(content)
        except (httpx.HTTPStatusError, httpx.RequestError) as e:
            logger.error(f"Failed to fetch ContentUrl {url}: {e}")
            return ""


async def _fetch_ris_website(url: str) -> str:
    """Fetch and extract legal text from the RIS website HTML page."""
    async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
        try:
            resp = await client.get(url)
            resp.raise_for_status()
            page_html = resp.text

            # Extract the main document text section
            # RIS website uses <div class="ContentBlock"> or <div id="TextBlock">
            # or <div class="judmark"> for the actual legal text
            text = _extract_ris_page_text(page_html)
            if text and len(text.strip()) > 20:
                return text
            return ""
        except (httpx.HTTPStatusError, httpx.RequestError) as e:
            logger.error(f"Failed to fetch RIS website {url}: {e}")
            return ""


def _extract_ris_page_text(page_html: str) -> str:
    """Extract the legal text from a RIS website HTML page."""
    # Try to find the main content area
    # Pattern 1: <h2>Text</h2> followed by content until next <h2>
    text_match = re.search(
        r'<h2[^>]*>\s*Text\s*</h2>(.*?)(?=<h2|<div\s+class="[^"]*FooterBlock)',
        page_html, re.DOTALL | re.IGNORECASE
    )
    if text_match:
        return _clean_html(text_match.group(1))

    # Pattern 2: Look for RISDocument or ContentBlock divs
    for pattern in [
        r'<div[^>]*class="[^"]*RISDocument[^"]*"[^>]*>(.*?)</div>',
        r'<div[^>]*class="[^"]*ContentBlock[^"]*"[^>]*>(.*?)</div>',
        r'<div[^>]*id="TextBlock"[^>]*>(.*?)</div>',
    ]:
        match = re.search(pattern, page_html, re.DOTALL | re.IGNORECASE)
        if match and len(match.group(1).strip()) > 50:
            return _clean_html(match.group(1))

    # Pattern 3: Find the largest <p> block or text block between known markers
    # Look for content between "Text" header and "Schlagworte" or "Beachte"
    for end_marker in ["Schlagworte", "Beachte", "Zuletzt aktualisiert"]:
        pattern = rf'Text\s*</(?:h2|td|div)>(.*?)(?:{end_marker})'
        match = re.search(pattern, page_html, re.DOTALL | re.IGNORECASE)
        if match and len(match.group(1).strip()) > 50:
            return _clean_html(match.group(1))

    return ""


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
    """Format when no previous version is available."""
    escaped = html_module.escape(text)
    return (
        '<p class="diff-info">Keine Vorversion gefunden — '
        'dies ist möglicherweise die Erstfassung oder es wurde nur '
        'ein RIS-Metadaten-Update durchgeführt (keine inhaltliche Änderung).</p>'
        f'<div class="diff-current">{escaped}</div>'
    )


# ── Helpers ──

def _clean_html(text: str) -> str:
    """Strip HTML tags and normalize whitespace."""
    # Remove script/style blocks
    clean = re.sub(r'<(script|style)[^>]*>.*?</\1>', '', text, flags=re.DOTALL | re.IGNORECASE)
    # Replace <br>, <p>, <div> with newlines
    clean = re.sub(r'<(?:br|/p|/div|/tr)[^>]*>', '\n', clean, flags=re.IGNORECASE)
    # Remove remaining tags
    clean = re.sub(r'<[^>]+>', ' ', clean)
    # Decode HTML entities
    clean = html_module.unescape(clean)
    # Normalize whitespace (but keep paragraph breaks)
    clean = re.sub(r'[ \t]+', ' ', clean)
    clean = re.sub(r'\n\s*\n', '\n\n', clean)
    clean = clean.strip()
    return clean


def _day_before(date_str: str) -> str | None:
    """Parse a date string and return the day before as YYYY-MM-DD."""
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
    """Flatten nested metadata sections."""
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


def _summarize_structure(obj, depth=0) -> str:
    """Summarize a nested dict/list structure for logging."""
    if depth > 3:
        return "..."
    if isinstance(obj, dict):
        keys = list(obj.keys())[:10]
        return "{" + ", ".join(f"{k}: {_summarize_structure(obj[k], depth+1)}" for k in keys) + "}"
    if isinstance(obj, list):
        if not obj:
            return "[]"
        return f"[{_summarize_structure(obj[0], depth+1)}... x{len(obj)}]"
    if isinstance(obj, str):
        return f'"{obj[:60]}..."' if len(obj) > 60 else f'"{obj}"'
    return str(obj)


async def _fetch_ris(url: str, params: dict) -> dict | None:
    """Execute HTTP GET against RIS API."""
    logger.info(f"RIS API: GET {url} params={params}")
    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            resp = await client.get(url, params=params)
            resp.raise_for_status()
            return resp.json()
        except (httpx.HTTPStatusError, httpx.RequestError) as e:
            logger.error(f"RIS request error: {e}")
            return None
