"""Service for fetching and comparing versions of RIS Bundesrecht provisions.

All data comes from the RIS website (ris.bka.gv.at).

Strategy:
1. Fetch the NOR document page from the RIS website.
2. Extract text + metadata + "Alle Fassungen" version links.
3. Fetch the previous version's page using the NOR ID from the version links.
4. Compute word-level diff.
"""

import difflib
import html as html_module
import logging
import re

import httpx

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
            result["version_nor_ids"] = parsed.get("version_nor_ids", [])

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

    # 1. Fetch current document page (text + metadata + version links)
    current = await _fetch_document_from_website(doc_id)
    if not current or not current.get("text"):
        return _error_result(
            "Dokumenttext konnte nicht von der RIS-Website geladen werden."
        )

    meta = current["metadata"]
    version_nor_ids = current.get("version_nor_ids", [])

    # 2. Find previous version from "Alle Fassungen" links
    prev = None
    if version_nor_ids:
        prev = await _find_previous_from_versions(doc_id, version_nor_ids)

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
    """Parse a RIS Bundesrecht document page: extract text, metadata, and version links."""
    result = {"text": "", "metadata": {}, "version_nor_ids": []}

    if not page_html or len(page_html) < 200:
        return result

    # ── Extract metadata ──
    # The RIS website puts metadata as plain text visible on the page.
    # Strategy: search for known label strings in the cleaned body text
    # and grab the value after them.
    #
    # We also look for the labels in the raw HTML, searching for the label
    # text followed by some value within nearby tags/text.

    meta_labels = {
        "Gesetzesnummer": "Gesetzesnummer",
        "Kurztitel": "Kurztitel",
        "Kundmachungsorgan": "Kundmachungsorgan",
        "Typ": "Typ",
        "§/Artikel/Anlage": "ArtikelParagraphAnlage",
        "Inkrafttretensdatum": "Inkrafttretensdatum",
        "Außerkrafttretensdatum": "Ausserkrafttretensdatum",
        "Abkürzung": "Abkürzung",
        "Index": "Index",
    }

    for html_label, key in meta_labels.items():
        # Find the label in HTML, then grab the next chunk of visible text
        # The label might be in any tag: <td>, <span>, <div>, <dt>, etc.
        # Approach: find label position, then look ahead for text content
        escaped_label = re.escape(html_label)
        # Pattern: label text followed by closing tag, then value in next element(s)
        # Handles: >Gesetzesnummer</td><td>10001702</td>
        #          >Gesetzesnummer</span><span>10001702</span>
        #          >Gesetzesnummer</div><div>10001702</div>
        #          and any whitespace/tags between
        pattern = rf'>\s*{escaped_label}\s*</[^>]+>\s*(?:<[^>]+>\s*)*([^<]+)'
        match = re.search(pattern, page_html, re.IGNORECASE)
        if match:
            val = match.group(1).strip()
            # Clean up common artifacts
            val = html_module.unescape(val)
            val = val.strip()
            if val and len(val) < 500:
                result["metadata"][key] = val
                continue

        # Fallback: look for label in plain text and grab value on same/next line
        idx = page_html.find(html_label)
        if idx < 0 and html_label == "§/Artikel/Anlage":
            idx = page_html.find("§/Artikel")
        if idx >= 0:
            # Get the next 500 chars after the label
            chunk = page_html[idx + len(html_label):idx + len(html_label) + 500]
            # Strip HTML tags and get first meaningful text
            cleaned = re.sub(r'<[^>]+>', ' ', chunk)
            cleaned = html_module.unescape(cleaned).strip()
            # Take the first line/value (up to newline or excessive whitespace)
            val_match = re.match(r'[\s:]*(.+?)(?:\n|$)', cleaned)
            if val_match:
                val = val_match.group(1).strip()
                if val and len(val) < 500:
                    result["metadata"][key] = val

    logger.info(f"Parsed metadata: {result['metadata']}")

    # ── Extract "Alle Fassungen" version links ──
    # The RIS page has links like:
    #   <a href="...Dokumentnummer=NOR40069839...">§ 123 gültig ab 01.01.2007...</a>
    # in the "Alle Fassungen" section. We extract all NOR IDs (ordered newest-first).
    nor_ids = []

    # Find the "Alle Fassungen" section and extract NOR numbers from links
    fassungen_idx = page_html.find("Alle Fassungen")
    if fassungen_idx >= 0:
        # Look at a chunk of HTML after "Alle Fassungen"
        fassungen_chunk = page_html[fassungen_idx:fassungen_idx + 5000]
        # Extract all NOR document numbers from links in this section
        nor_matches = re.findall(r'Dokumentnummer=(NOR\d+)', fassungen_chunk)
        # Deduplicate while preserving order
        seen = set()
        for nor in nor_matches:
            if nor not in seen:
                seen.add(nor)
                nor_ids.append(nor)
        logger.info(f"Alle Fassungen NOR IDs: {nor_ids}")

    # Also look for NOR IDs in links with "gültig" text (version links anywhere on page)
    if not nor_ids:
        version_links = re.findall(
            r'Dokumentnummer=(NOR\d+)[^"]*"[^>]*>[^<]*gültig',
            page_html
        )
        seen = set()
        for nor in version_links:
            if nor not in seen:
                seen.add(nor)
                nor_ids.append(nor)
        if nor_ids:
            logger.info(f"Version links NOR IDs (fallback): {nor_ids}")

    result["version_nor_ids"] = nor_ids

    # ── Extract the legal text ──
    # Strategy 1: Find ">Text<" label, then grab content until next section
    section_labels = [
        "Schlagworte", "Zuletzt aktualisiert",
        "Dokumentnummer", "European Legislation Identifier",
        "Navigation im Suchergebnis", "Zum Seitenanfang",
        "Über diese Seite",
    ]
    end_pattern = "|".join(re.escape(label) for label in section_labels)

    text_match = re.search(
        rf'>\s*Text\s*</[^>]+>(.*?)({end_pattern})',
        page_html, re.DOTALL | re.IGNORECASE
    )
    if text_match:
        raw = text_match.group(1)
        text = _clean_html(raw).strip()
        # Remove accessible text duplicates:
        # RIS renders "§ 123." followed by "Paragraph 123,"
        # and "(1)" followed by "Absatz eins,"
        text = _remove_accessible_duplicates(text)
        if len(text) > 20:
            result["text"] = text
            return result

    # Strategy 2: Find largest text block with legal content patterns
    blocks = re.findall(r'<(?:td|div)[^>]*>(.*?)</(?:td|div)>', page_html, re.DOTALL)
    best = ""
    for block in blocks:
        cleaned = _clean_html(block)
        if len(cleaned) > len(best) and len(cleaned) > 100:
            if re.search(r'\(\d+\)|§\s*\d+|Abs\.|Absatz', cleaned):
                best = cleaned
    if best:
        result["text"] = _remove_accessible_duplicates(best)

    return result


def _remove_accessible_duplicates(text: str) -> str:
    """Remove RIS accessible text duplications.

    RIS renders text like:
      "§ 123. Paragraph 123," → should be just "§ 123."
      "(1) Absatz eins," → should be just "(1)"
      "(2) Absatz 2," → should be just "(2)"
    """
    # Remove "Paragraph NNN," after "§ NNN."
    text = re.sub(r'(§\s*\d+[a-z]?\.?)\s*Paragraph\s*\d+[a-z]?,?\s*', r'\1 ', text)
    # Remove "Absatz eins/zwei/drei/..." after "(N)"
    text = re.sub(
        r'(\(\d+\))\s*Absatz\s*(?:eins|zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn|\d+),?\s*',
        r'\1 ', text
    )
    # Remove "Anmerkung, aus Bundesgesetzblatt..." duplicates
    text = re.sub(r'Anmerkung,\s*aus Bundesgesetzblatt[^)]*\)\s*', '', text)
    # Remove "Paragraph NNN," standalone (without preceding §)
    text = re.sub(r'\bParagraph\s+\d+,\s*', '', text)
    # Remove duplicate "Paragraphen X, ff." after "§§ X ff."
    text = re.sub(r'(§§?\s*\d+[^)]*)\s*Paragraphen\s*\d+[^)]*', r'\1', text)
    # Normalize multiple spaces
    text = re.sub(r'  +', ' ', text)
    return text.strip()


# ── Previous version lookup (from "Alle Fassungen" links) ──

async def _find_previous_from_versions(
    current_doc_id: str,
    version_nor_ids: list[str],
) -> dict | None:
    """Find the previous version from the list of NOR IDs extracted from
    the "Alle Fassungen" section of the RIS document page.

    The list is ordered newest-first. The current doc is one of them;
    the next entry after it is the previous version.
    """
    # Find the current document in the list, take the next one
    prev_id = None
    for i, nor_id in enumerate(version_nor_ids):
        if nor_id == current_doc_id and i + 1 < len(version_nor_ids):
            prev_id = version_nor_ids[i + 1]
            break

    if not prev_id:
        # Maybe the current doc wasn't found in the list (e.g. "heute" link)
        # Try the second entry if the first entry is likely the current
        if len(version_nor_ids) >= 2:
            if version_nor_ids[0] == current_doc_id:
                prev_id = version_nor_ids[1]
            else:
                # The first entry might be the "heute" version which is the same
                # Try to find any different NOR ID
                for nor_id in version_nor_ids:
                    if nor_id != current_doc_id:
                        prev_id = nor_id
                        break

    if not prev_id:
        logger.info(f"No previous version found in Alle Fassungen (versions: {version_nor_ids})")
        return None

    logger.info(f"Previous version from Alle Fassungen: {prev_id}")

    # Fetch the previous version's text from its website page
    prev_doc = await _fetch_document_from_website(prev_id)
    if not prev_doc or not prev_doc.get("text"):
        logger.info(f"Could not fetch text for previous version {prev_id}")
        return None

    return {
        "text": prev_doc["text"],
        "inkrafttreten": prev_doc["metadata"].get("Inkrafttretensdatum", ""),
        "bgbl": prev_doc["metadata"].get("Kundmachungsorgan", ""),
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


