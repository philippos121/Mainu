"""Service for fetching and comparing versions of RIS Bundesrecht provisions.

All data comes from the RIS website (ris.bka.gv.at).

Strategy:
1. Fetch the current document page from the RIS website → extract text.
2. Fetch the same page with &FassungVom=<ris_updated - 1 day> → extract old text.
3. Compute word-level diff.

The key insight: the RIS website supports a FassungVom URL parameter that
shows the provision as it was valid on that date. By using the day before
the "Zuletzt aktualisiert am" date, we get the previous version.
"""

import difflib
import html as html_module
import logging
import re
from datetime import datetime, timedelta

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
            page = resp.text
            result["website_status"] = resp.status_code
            result["website_body_length"] = len(page)

            parsed = _parse_ris_page(page)
            result["parsed_text_length"] = len(parsed["text"])
            result["parsed_text"] = (parsed["text"][:500] + "...") if len(parsed["text"]) > 500 else parsed["text"]
            result["parsed_metadata"] = parsed["metadata"]

            # Also test FassungVom
            fassung_url = ris_url + "&FassungVom=2026-03-18"
            resp2 = await client.get(fassung_url)
            parsed2 = _parse_ris_page(resp2.text)
            result["fassung_vom_text_length"] = len(parsed2["text"])
            result["fassung_vom_text"] = (parsed2["text"][:500] + "...") if len(parsed2["text"]) > 500 else parsed2["text"]
            result["fassung_vom_metadata"] = parsed2["metadata"]
        except Exception as e:
            result["error"] = str(e)
    return result


async def fetch_provision_diff(doc_id: str, ris_updated: str = "") -> dict:
    """Fetch current + previous version, return diff.

    Args:
        doc_id: NOR document number
        ris_updated: "Zuletzt aktualisiert am" date (DD.MM.YYYY or YYYY-MM-DD)
                     Used to compute the FassungVom date for the previous version.
    """
    # 1. Fetch current version (today's version)
    current_url = (
        f"https://www.ris.bka.gv.at/Dokument.wxe"
        f"?Abfrage=Bundesnormen&Dokumentnummer={doc_id}"
    )
    current = await _fetch_and_parse(current_url)
    if not current or not current.get("text"):
        return _error_result(
            "Dokumenttext konnte nicht von der RIS-Website geladen werden."
        )

    meta = current["metadata"]

    # 2. Determine the FassungVom date for the previous version
    # Use ris_updated (Zuletzt aktualisiert am) - 1 day
    # Fall back to metadata Inkrafttretensdatum - 1 day if no ris_updated
    fassung_vom = None
    for date_str in [ris_updated, meta.get("Zuletzt aktualisiert am", ""),
                     meta.get("Inkrafttretensdatum", "")]:
        fassung_vom = _day_before(date_str)
        if fassung_vom:
            break

    if not fassung_vom:
        return {
            "current": {
                "text": current["text"],
                "info": meta.get("Kundmachungsorgan", ""),
                "date": meta.get("Inkrafttretensdatum", ""),
            },
            "previous": None,
            "diff_html": _format_no_previous(current["text"]),
            "has_changes": False,
        }

    # 3. Fetch previous version using FassungVom
    prev_url = (
        f"https://www.ris.bka.gv.at/Dokument.wxe"
        f"?Abfrage=Bundesnormen&Dokumentnummer={doc_id}"
        f"&FassungVom={fassung_vom}"
    )
    logger.info(f"Fetching previous version: FassungVom={fassung_vom}")
    prev = await _fetch_and_parse(prev_url)

    # 4. Compute diff
    if prev and prev.get("text") and prev["text"].strip() != current["text"].strip():
        diff_html = _compute_word_diff(prev["text"], current["text"])
        has_changes = True
        prev_result = {
            "text": prev["text"],
            "info": prev["metadata"].get("Kundmachungsorgan", ""),
            "date": f"Fassung vom {fassung_vom}",
        }
    elif prev and prev.get("text") and prev["text"].strip() == current["text"].strip():
        # Same text → metadata-only update
        diff_html = (
            '<p class="diff-info">Kein inhaltlicher Unterschied zwischen '
            f'der aktuellen Fassung und der Fassung vom {fassung_vom}. '
            'Es handelt sich vermutlich um ein reines RIS-Metadaten-Update.</p>'
            f'<div class="diff-current">{html_module.escape(current["text"])}</div>'
        )
        has_changes = False
        prev_result = None
    else:
        diff_html = _format_no_previous(current["text"])
        has_changes = False
        prev_result = None

    return {
        "current": {
            "text": current["text"],
            "info": meta.get("Kundmachungsorgan", ""),
            "date": meta.get("Inkrafttretensdatum", ""),
        },
        "previous": prev_result,
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

async def _fetch_and_parse(url: str) -> dict | None:
    """Fetch a RIS website page and extract text + metadata."""
    logger.info(f"Fetching: {url}")
    async with httpx.AsyncClient(timeout=25.0, follow_redirects=True, headers=_HEADERS) as client:
        try:
            resp = await client.get(url)
            resp.raise_for_status()
            logger.info(f"Response: status={resp.status_code}, length={len(resp.text)}")
            parsed = _parse_ris_page(resp.text)
            if parsed["text"]:
                logger.info(f"Extracted: text={len(parsed['text'])} chars")
            return parsed
        except Exception as e:
            logger.error(f"Failed to fetch {url}: {e}")
            return None


def _parse_ris_page(page_html: str) -> dict:
    """Parse a RIS Bundesrecht document page: extract text and metadata."""
    result = {"text": "", "metadata": {}}

    if not page_html or len(page_html) < 200:
        return result

    # ── Extract metadata ──
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
        "Zuletzt aktualisiert am": "Zuletzt aktualisiert am",
    }

    for html_label, key in meta_labels.items():
        escaped_label = re.escape(html_label)
        # Pattern: >Label</tag> <tag>Value
        pattern = rf'>\s*{escaped_label}\s*</[^>]+>\s*(?:<[^>]+>\s*)*([^<]+)'
        match = re.search(pattern, page_html, re.IGNORECASE)
        if match:
            val = html_module.unescape(match.group(1).strip())
            if val and len(val) < 500:
                result["metadata"][key] = val
                continue

        # Fallback: raw text search
        idx = page_html.find(html_label)
        if idx < 0 and "§/Artikel" in html_label:
            idx = page_html.find("§/Artikel")
        if idx >= 0:
            chunk = page_html[idx + len(html_label):idx + len(html_label) + 500]
            cleaned = re.sub(r'<[^>]+>', ' ', chunk)
            cleaned = html_module.unescape(cleaned).strip()
            val_match = re.match(r'[\s:]*(.+?)(?:\n|$)', cleaned)
            if val_match:
                val = val_match.group(1).strip()
                if val and len(val) < 500:
                    result["metadata"][key] = val

    logger.info(f"Parsed metadata: {result['metadata']}")

    # ── Extract the legal text ──
    section_labels = [
        "Schlagworte", "Zuletzt aktualisiert",
        "Dokumentnummer", "European Legislation Identifier",
        "Navigation im Suchergebnis", "Zum Seitenanfang",
        "Über diese Seite",
    ]
    end_pattern = "|".join(re.escape(label) for label in section_labels)

    # Strategy 1: Find ">Text</tag>" then grab content until next section
    text_match = re.search(
        rf'>\s*Text\s*</[^>]+>(.*?)({end_pattern})',
        page_html, re.DOTALL | re.IGNORECASE
    )
    if text_match:
        raw = text_match.group(1)
        text = _clean_html(raw).strip()
        text = _remove_accessible_duplicates(text)
        if len(text) > 20:
            result["text"] = text
            return result

    # Strategy 2: Find largest block with legal text patterns
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
    """Remove RIS accessible text duplications."""
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
        'dies ist möglicherweise die Erstfassung.</p>'
        f'<div class="diff-current">{escaped}</div>'
    )


# ── Helpers ──

def _day_before(date_str: str) -> str | None:
    """Parse a date and return the day before as YYYY-MM-DD."""
    if not date_str:
        return None
    date_str = date_str.strip()
    for fmt in ("%d.%m.%Y", "%Y-%m-%d", "%Y-%m-%dT%H:%M:%S"):
        try:
            dt = datetime.strptime(date_str.split("+")[0].split(".000")[0], fmt)
            prev = dt - timedelta(days=1)
            return prev.strftime("%Y-%m-%d")
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
