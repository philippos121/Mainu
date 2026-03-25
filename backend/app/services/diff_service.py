"""Service for fetching and comparing versions of RIS Bundesrecht provisions.

All data comes from the RIS website (ris.bka.gv.at) since the OGD API
does not return results for Dokumentnummer queries with BrKons.

Strategy:
1. Fetch the NOR document page from the RIS website.
2. Extract text + metadata (Gesetzesnummer, Artikel, Inkrafttretensdatum).
3. Find previous version via OGD API FassungVom query.
4. Fetch previous version text from website too.
5. Compute word-level diff.
"""

import difflib
import html as html_module
import logging
import re
from datetime import timedelta

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "de-AT,de;q=0.9,en;q=0.5",
}


async def debug_document(doc_id: str) -> dict:
    """DEBUG: return raw data from website for a document."""
    result = {}
    ris_url = f"https://www.ris.bka.gv.at/Dokument.wxe?Abfrage=Bundesnormen&Dokumentnummer={doc_id}"
    async with httpx.AsyncClient(timeout=20.0, follow_redirects=True, headers=_HEADERS) as client:
        try:
            resp = await client.get(ris_url)
            html = resp.text
            result["website_status"] = resp.status_code
            result["website_body_length"] = len(html)

            parsed = _parse_ris_page(html)
            result["parsed_text"] = (parsed["text"][:500] + "...") if len(parsed["text"]) > 500 else parsed["text"]
            result["parsed_text_length"] = len(parsed["text"])
            result["parsed_metadata"] = parsed["metadata"]

            # Show HTML context around key metadata labels
            for label in ["Gesetzesnummer", "Inkrafttretensdatum", "Kurztitel", "§/Artikel"]:
                idx = html.find(label)
                if idx >= 0:
                    start = max(0, idx - 100)
                    end = min(len(html), idx + 300)
                    result[f"html_around_{label}"] = html[start:end]
                else:
                    result[f"html_around_{label}"] = "(not found)"
        except Exception as e:
            result["error"] = str(e)
    return result


async def fetch_provision_diff(doc_id: str) -> dict:
    """Fetch current + previous version, return diff."""

    # 1. Fetch current document from website
    current = await _fetch_document_from_website(doc_id)
    if not current or not current.get("text"):
        return _error_result(
            "Dokumenttext konnte nicht von der RIS-Website geladen werden."
        )

    meta = current["metadata"]

    # 2. Find and fetch previous version
    prev = None
    gesetzesnr = meta.get("Gesetzesnummer", "")
    artikel = meta.get("ArtikelParagraphAnlage", "")
    inkrafttreten = meta.get("Inkrafttretensdatum", "")

    if gesetzesnr and artikel and inkrafttreten:
        prev = await _find_previous_version(
            gesetzesnummer=gesetzesnr,
            artikel=artikel,
            current_inkrafttreten=inkrafttreten,
            current_doc_id=doc_id,
        )

    # 3. Compute diff
    if prev and prev.get("text"):
        diff_html = _compute_word_diff(prev["text"], current["text"])
        has_changes = prev["text"].strip() != current["text"].strip()
    else:
        diff_html = _format_no_previous(current["text"])
        has_changes = False

    return {
        "current": {
            "text": current["text"],
            "info": meta.get("Kundmachungsorgan", ""),
            "date": inkrafttreten,
        },
        "previous": {
            "text": prev["text"],
            "info": prev.get("bgbl", ""),
            "date": prev.get("inkrafttreten", ""),
        } if prev and prev.get("text") else None,
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


# ── Fetch + parse from RIS website ──

async def _fetch_document_from_website(doc_id: str) -> dict | None:
    """Fetch a document page from the RIS website and extract text + metadata."""
    ris_url = f"https://www.ris.bka.gv.at/Dokument.wxe?Abfrage=Bundesnormen&Dokumentnummer={doc_id}"
    logger.info(f"Fetching: {ris_url}")

    async with httpx.AsyncClient(timeout=25.0, follow_redirects=True, headers=_HEADERS) as client:
        try:
            resp = await client.get(ris_url)
            resp.raise_for_status()
            logger.info(f"RIS website: status={resp.status_code}, length={len(resp.text)}")
            parsed = _parse_ris_page(resp.text)
            if parsed["text"]:
                logger.info(f"Extracted: text={len(parsed['text'])} chars, meta keys={list(parsed['metadata'].keys())}")
            return parsed
        except Exception as e:
            logger.error(f"Failed to fetch RIS website for {doc_id}: {e}")
            return None


def _parse_ris_page(page_html: str) -> dict:
    """Parse a RIS Bundesrecht document page: extract text and metadata table."""
    result = {"text": "", "metadata": {}}

    if not page_html or len(page_html) < 200:
        return result

    # ── Extract metadata from the info table ──
    # RIS shows metadata as label-value pairs. Labels have class containing
    # "Titel" or are <th> elements. The structure is typically:
    #   <td class="...Titel...">Kurztitel</td><td>Unternehmensgesetzbuch</td>
    # or similar patterns.

    # Pattern: find all label-value pairs in the document info section
    # Look for patterns like: >LabelText</td> ... <td ...>ValueText</td>
    meta_patterns = [
        # <td class="...">Label</td>...<td...>Value</td>
        (r'<td[^>]*>\s*' + label + r'\s*</td>\s*<td[^>]*>(.*?)</td>')
        for label in [
            "Gesetzesnummer", "Kurztitel", "Kundmachungsorgan", "Typ",
            r"§/Artikel/Anlage", "Inkrafttretensdatum", "Außerkrafttretensdatum",
            "Abkürzung", "Index", "Beachte",
        ]
    ]

    for label, pattern in zip(
        ["Gesetzesnummer", "Kurztitel", "Kundmachungsorgan", "Typ",
         "ArtikelParagraphAnlage", "Inkrafttretensdatum", "Ausserkrafttretensdatum",
         "Abkürzung", "Index", "Beachte"],
        meta_patterns
    ):
        match = re.search(pattern, page_html, re.DOTALL | re.IGNORECASE)
        if match:
            val = _clean_html(match.group(1)).strip()
            if val:
                result["metadata"][label] = val

    # Fallback: try a more generic approach for metadata
    # Look for all <td> with class containing "Titel" followed by a value <td>
    if not result["metadata"].get("Gesetzesnummer"):
        rows = re.findall(
            r'<td[^>]*class="[^"]*[Tt]itel[^"]*"[^>]*>(.*?)</td>\s*<td[^>]*>(.*?)</td>',
            page_html, re.DOTALL
        )
        label_map = {
            "gesetzesnummer": "Gesetzesnummer",
            "kurztitel": "Kurztitel",
            "kundmachungsorgan": "Kundmachungsorgan",
            "typ": "Typ",
            "§/artikel/anlage": "ArtikelParagraphAnlage",
            "inkrafttretensdatum": "Inkrafttretensdatum",
            "abkürzung": "Abkürzung",
            "index": "Index",
        }
        for raw_label, raw_value in rows:
            clean_label = _clean_html(raw_label).strip().lower()
            for key, mapped in label_map.items():
                if key in clean_label:
                    val = _clean_html(raw_value).strip()
                    if val and mapped not in result["metadata"]:
                        result["metadata"][mapped] = val

    # ── Extract the legal text ──
    # The text section comes after a "Text" label in the metadata table,
    # or in a specific content div.

    # Strategy 1: Find the "Text" section in the table structure
    # The RIS page has: <td>Text</td><td><div>...actual legal text...</div></td>
    text_match = re.search(
        r'<td[^>]*>\s*Text\s*</td>\s*<td[^>]*>(.*?)</td>\s*</tr>',
        page_html, re.DOTALL | re.IGNORECASE
    )
    if text_match:
        raw = text_match.group(1)
        # Remove any nested <div> id attributes that might be partial HTML
        raw = re.sub(r'<div[^>]*id="[^"]*"[^>]*/?\s*>', '', raw)
        text = _clean_html(raw).strip()
        if len(text) > 20:
            result["text"] = text
            return result

    # Strategy 2: Broader — find text between "Text" marker and next known section
    section_labels = [
        "Schlagworte", "Zuletzt aktualisiert", "Gesetzesnummer",
        "Dokumentnummer", "European Legislation Identifier",
        "Navigation im Suchergebnis", "Zum Seitenanfang",
        "Über diese Seite",
    ]
    end_pattern = "|".join(re.escape(label) for label in section_labels)

    # Look for >Text< then grab everything until next section
    text_match = re.search(
        rf'>\s*Text\s*</(td|th|div|span|h\d)[^>]*>(.*?)({end_pattern})',
        page_html, re.DOTALL | re.IGNORECASE
    )
    if text_match:
        raw = text_match.group(2)
        raw = re.sub(r'<div[^>]*id="[^"]*"[^>]*/?\s*>', '', raw)
        text = _clean_html(raw).strip()
        if len(text) > 20:
            result["text"] = text
            return result

    # Strategy 3: Look for the RIS content document div
    doc_divs = re.findall(
        r'<div[^>]*class="[^"]*[Dd]ocument[^"]*"[^>]*>(.*?)</div>',
        page_html, re.DOTALL
    )
    for div_content in doc_divs:
        cleaned = _clean_html(div_content).strip()
        if len(cleaned) > 100 and re.search(r'\(\d+\)|§\s*\d+|Abs\.', cleaned):
            result["text"] = cleaned
            return result

    return result


# ── Previous version lookup ──

async def _find_previous_version(
    gesetzesnummer: str,
    artikel: str,
    current_inkrafttreten: str,
    current_doc_id: str,
) -> dict | None:
    """Find the previous version using OGD API FassungVom, then fetch text from website."""
    fassung_vom = _day_before(current_inkrafttreten)
    if not fassung_vom:
        logger.warning(f"Cannot parse Inkrafttretensdatum: {current_inkrafttreten}")
        return None

    # Query OGD API for the version valid on the day before current Inkrafttreten
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
        logger.info(f"Previous version is same document ({prev_id}), metadata-only update")
        return None

    if not prev_id:
        logger.info("Could not determine previous version document ID")
        return None

    logger.info(f"Previous version found: {prev_id}")

    # Fetch text from website
    prev_doc = await _fetch_document_from_website(prev_id)
    if not prev_doc or not prev_doc.get("text"):
        return None

    return {
        "text": prev_doc["text"],
        "inkrafttreten": _s(m.get("Inkrafttretensdatum")) or prev_doc["metadata"].get("Inkrafttretensdatum", ""),
        "bgbl": _s(m.get("Kundmachungsorgan")) or prev_doc["metadata"].get("Kundmachungsorgan", ""),
        "doc_id": prev_id,
    }


# ── Diff computation ──

def _compute_word_diff(old_text: str, new_text: str) -> str:
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


# ── Helpers ──

def _clean_html(text: str) -> str:
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


async def _fetch_ris(url: str, params: dict) -> dict | None:
    logger.info(f"RIS API: {url} params={params}")
    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            resp = await client.get(url, params=params)
            resp.raise_for_status()
            return resp.json()
        except (httpx.HTTPStatusError, httpx.RequestError) as e:
            logger.error(f"RIS API error: {e}")
            return None
