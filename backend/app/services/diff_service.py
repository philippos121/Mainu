"""Service for fetching and comparing versions of RIS Bundesrecht provisions.

Strategy:
1. Fetch the current NOR document to get its full text + metadata
   (Gesetzesnummer, ArtikelParagraphAnlage, Inkrafttretensdatum).
2. Use Gesetzesnummer + ArtikelParagraphAnlage + FassungVom (one day before
   current Inkrafttretensdatum) to find the previous version.
3. Compute a word-level diff between old and new text.
"""

import difflib
import html
import logging
import re
from datetime import date, timedelta

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)


async def fetch_provision_diff(doc_id: str) -> dict:
    """Fetch current + previous version of a Bundesrecht provision, return diff.

    Args:
        doc_id: NOR document number (e.g., "NOR40069839")

    Returns:
        {
            "current": {"text": ..., "info": ..., "date": ...},
            "previous": {"text": ..., "info": ..., "date": ...} | None,
            "diff_html": "...",
            "has_changes": bool,
        }
    """
    # 1. Fetch the current document
    current_doc = await _fetch_document(doc_id)
    if not current_doc or not current_doc.get("text"):
        return {
            "current": None,
            "previous": None,
            "diff_html": "<p>Dokumenttext konnte nicht geladen werden.</p>",
            "has_changes": False,
            "error": "Dokumenttext konnte nicht aus RIS geladen werden.",
        }

    # 2. Find the previous version
    prev_doc = None
    if current_doc.get("gesetzesnummer") and current_doc.get("artikel"):
        inkrafttreten = current_doc.get("inkrafttreten", "")
        prev_doc = await _fetch_previous_version(
            gesetzesnummer=current_doc["gesetzesnummer"],
            artikel=current_doc["artikel"],
            current_inkrafttreten=inkrafttreten,
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


async def _fetch_document(doc_id: str) -> dict | None:
    """Fetch a single Bundesrecht document by NOR number and extract text + metadata."""
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

    # Extract text from multiple possible locations
    text = _extract_text(data_entry)

    # Extract metadata
    m = _collect_flat_metadata(metadata)

    gesetzesnummer = (
        _s(m.get("Gesetzesnummer"))
        or _s(data_entry.get("Gesetzesnummer"))
        or ""
    )
    artikel = (
        _s(m.get("ArtikelParagraphAnlage"))
        or _s(data_entry.get("ArtikelParagraphAnlage"))
        or ""
    )
    inkrafttreten = (
        _s(m.get("Inkrafttretensdatum"))
        or _s(data_entry.get("Inkrafttretensdatum"))
        or ""
    )
    bgbl = (
        _s(m.get("Kundmachungsorgan"))
        or _s(m.get("Aenderung"))
        or ""
    )

    logger.info(
        f"Document {doc_id}: gesetzesnr={gesetzesnummer}, "
        f"artikel={artikel}, inkraft={inkrafttreten}, text_len={len(text)}"
    )

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

    # Parse the Inkrafttretensdatum to compute the day before
    fassung_vom = _day_before(current_inkrafttreten)
    if not fassung_vom:
        # If we can't parse the date, try fetching all versions and pick the prior one
        logger.warning(f"Cannot parse Inkrafttretensdatum: {current_inkrafttreten}")
        return await _fetch_previous_by_search(gesetzesnummer, artikel, current_doc_id)

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

    # Make sure it's actually a different version
    prev_id = (
        _s(m.get("ID"))
        or _s(m.get("Dokumentnummer"))
        or _s(data_entry.get("Dokumentnummer"))
        or ""
    )
    if prev_id == current_doc_id:
        logger.info(f"Previous version is same document ({prev_id}), no change")
        return None

    text = _extract_text(data_entry)
    if not text:
        logger.info("Previous version has no text")
        return None

    inkrafttreten = _s(m.get("Inkrafttretensdatum")) or ""
    bgbl = _s(m.get("Kundmachungsorgan")) or _s(m.get("Aenderung")) or ""

    logger.info(f"Previous version: {prev_id}, inkraft={inkrafttreten}, text_len={len(text)}")

    return {
        "text": text,
        "inkrafttreten": inkrafttreten,
        "bgbl": bgbl,
        "doc_id": prev_id,
    }


async def _fetch_previous_by_search(
    gesetzesnummer: str,
    artikel: str,
    current_doc_id: str,
) -> dict | None:
    """Fallback: search for all versions and pick the one before the current."""
    params = {
        "Applikation": "BrKons",
        "Gesetzesnummer": gesetzesnummer,
        "ArtikelParagraphAnlage": artikel,
        "DokumenteProSeite": "Five",
    }
    url = f"{settings.RIS_API_BASE_URL}/Bundesrecht"

    logger.info(f"Fallback search for versions: GesNr={gesetzesnummer}, Art={artikel}")
    data = await _fetch_ris(url, params)
    if not data:
        return None

    refs = _extract_refs(data)
    # Find the ref right before the current one
    prev_ref = None
    found_current = False
    for ref in refs:
        data_entry = ref.get("Data", {})
        metadata = data_entry.get("Metadaten", {})
        m = _collect_flat_metadata(metadata)
        doc_id = (
            _s(m.get("ID"))
            or _s(m.get("Dokumentnummer"))
            or _s(data_entry.get("Dokumentnummer"))
            or ""
        )
        if doc_id == current_doc_id:
            found_current = True
            continue
        if found_current:
            prev_ref = ref
            break

    if not prev_ref:
        return None

    data_entry = prev_ref.get("Data", {})
    metadata = data_entry.get("Metadaten", {})
    m = _collect_flat_metadata(metadata)
    text = _extract_text(data_entry)

    return {
        "text": text,
        "inkrafttreten": _s(m.get("Inkrafttretensdatum")) or "",
        "bgbl": _s(m.get("Kundmachungsorgan")) or "",
        "doc_id": _s(m.get("ID")) or _s(m.get("Dokumentnummer")) or "",
    } if text else None


# ── Text extraction ──

def _extract_text(data_entry: dict) -> str:
    """Extract the provision text from a RIS document data entry.

    The text can be in several places depending on the API response:
    - Data.Dokumentinhalt (sometimes HTML, sometimes plain text)
    - Data.Inhalt
    - Data.ContentReference.Urls.ContentUrl (URL to fetch separately)
    """
    # Try direct text content fields
    for key in ("Dokumentinhalt", "Inhalt", "Text"):
        val = data_entry.get(key)
        if val and isinstance(val, str) and len(val) > 10:
            return _clean_html(val)
        if isinstance(val, dict):
            # Could be {"#text": "..."} structure
            inner = val.get("#text", "")
            if inner and len(inner) > 10:
                return _clean_html(inner)

    # Try metadata sections for embedded text
    metadata = data_entry.get("Metadaten", {})
    for section_key in ("Allgemein", "Bundesrecht", "BrKons"):
        section = metadata.get(section_key)
        if isinstance(section, list) and section:
            section = section[0]
        if isinstance(section, dict):
            for key in ("Dokumentinhalt", "Inhalt", "Text"):
                val = section.get(key)
                if val and isinstance(val, str) and len(val) > 10:
                    return _clean_html(val)

    # Try Dokumentliste/Contentreference for content URLs
    doc_list = data_entry.get("Dokumentliste", {})
    if isinstance(doc_list, dict):
        content_ref = doc_list.get("ContentReference", {})
        if isinstance(content_ref, list) and content_ref:
            content_ref = content_ref[0]
        if isinstance(content_ref, dict):
            urls = content_ref.get("Urls", {})
            if isinstance(urls, dict):
                content_url = urls.get("ContentUrl", "")
                if content_url:
                    # We'd need to fetch this URL separately, but note it for logging
                    logger.info(f"Document has ContentUrl: {content_url}")

    return ""


def _clean_html(text: str) -> str:
    """Strip HTML tags and normalize whitespace to get plain text."""
    # Remove HTML tags
    clean = re.sub(r'<[^>]+>', ' ', text)
    # Decode HTML entities
    clean = html.unescape(clean)
    # Normalize whitespace
    clean = re.sub(r'\s+', ' ', clean).strip()
    # Restore paragraph breaks where there were block elements
    clean = re.sub(r'\s*\n\s*', '\n', clean)
    return clean


# ── Diff computation ──

def _compute_word_diff(old_text: str, new_text: str) -> str:
    """Compute a word-level diff and return styled HTML."""
    old_words = old_text.split()
    new_words = new_text.split()

    matcher = difflib.SequenceMatcher(None, old_words, new_words)
    parts: list[str] = []

    for op, i1, i2, j1, j2 in matcher.get_opcodes():
        if op == "equal":
            parts.append(html.escape(" ".join(old_words[i1:i2])))
        elif op == "delete":
            deleted = html.escape(" ".join(old_words[i1:i2]))
            parts.append(f'<span class="diff-del">{deleted}</span>')
        elif op == "insert":
            inserted = html.escape(" ".join(new_words[j1:j2]))
            parts.append(f'<span class="diff-ins">{inserted}</span>')
        elif op == "replace":
            deleted = html.escape(" ".join(old_words[i1:i2]))
            inserted = html.escape(" ".join(new_words[j1:j2]))
            parts.append(f'<span class="diff-del">{deleted}</span>')
            parts.append(f'<span class="diff-ins">{inserted}</span>')

    return " ".join(parts)


def _format_no_previous(text: str) -> str:
    """Format when no previous version is available."""
    return (
        '<p class="diff-info">Keine Vorversion gefunden — '
        'dies ist möglicherweise die Erstfassung oder es handelt sich '
        'um ein reines RIS-Metadaten-Update ohne inhaltliche Änderung.</p>'
        f'<div class="diff-current">{html.escape(text)}</div>'
    )


# ── Helpers ──

def _day_before(date_str: str) -> str | None:
    """Parse a date string and return the day before as YYYY-MM-DD."""
    if not date_str:
        return None
    # Try various formats
    for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%d", "%d.%m.%Y"):
        try:
            dt = __import__("datetime").datetime.strptime(date_str.split("+")[0], fmt)
            prev = dt - timedelta(days=1)
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


async def _fetch_ris(url: str, params: dict) -> dict | None:
    """Execute HTTP GET against RIS API."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            resp = await client.get(url, params=params)
            resp.raise_for_status()
            return resp.json()
        except (httpx.HTTPStatusError, httpx.RequestError) as e:
            logger.error(f"RIS request error: {e}")
            return None
