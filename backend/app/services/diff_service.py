"""Service for fetching and comparing versions of RIS Bundesrecht provisions.

Working approach:
1. Fetch current version text from RIS website (Dokument.wxe?Dokumentnummer=NOR...)
   — this gives us the specific § text, not the whole law.
2. Parse "Alle Fassungen" links from the same page to find the previous NOR number.
3. Fetch previous version text from its own Dokument.wxe page.
4. Compute word-level diff.

Why other approaches failed:
- API ContentUrls return the ENTIRE law, not the specific paragraph
- FassungVom on Dokument.wxe is ignored when a specific NOR is given
- BrKons API returns same consolidated NOR regardless of FassungVom
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

_DOC_BASE = "https://www.ris.bka.gv.at/Dokument.wxe?Abfrage=Bundesnormen&Dokumentnummer="


async def fetch_provision_diff(
    doc_id: str,
    gesetzesnummer: str,
    artikel: str,
    inkrafttreten: str,
) -> dict:
    """Fetch current + previous version and return diff."""
    logger.info(f"=== DIFF: NOR={doc_id}, Art={artikel}, Inkraft={inkrafttreten}")

    if not doc_id:
        return _error("Dokumentnummer (NOR) fehlt.")

    # 1. Fetch current page — get text AND all version NOR links
    current_page = await _fetch_ris_page(doc_id)
    if not current_page:
        return _error(f"Seite für {doc_id} konnte nicht geladen werden.")

    current_text = current_page["text"]
    if not current_text:
        return _error(f"Text für {doc_id} konnte nicht extrahiert werden.")

    all_nors = current_page["version_nors"]
    logger.info(f"Current text: {len(current_text)} chars, Alle Fassungen NORs: {all_nors}")

    # 2. Find previous NOR from Alle Fassungen
    prev_nor = _find_previous_nor(doc_id, all_nors)

    if not prev_nor:
        return {
            "current": {"text": current_text, "date": inkrafttreten},
            "previous": None,
            "diff_html": _no_prev_html(
                "Keine Vorversion in 'Alle Fassungen' gefunden — "
                "möglicherweise die Erstfassung oder ein reines Metadaten-Update.",
                current_text
            ),
            "has_changes": False,
        }

    logger.info(f"Previous NOR: {prev_nor}")

    # 3. Fetch previous version text
    prev_page = await _fetch_ris_page(prev_nor)
    prev_text = prev_page["text"] if prev_page else ""

    if not prev_text:
        return {
            "current": {"text": current_text, "date": inkrafttreten},
            "previous": None,
            "diff_html": _no_prev_html(f"Text der Vorversion ({prev_nor}) konnte nicht geladen werden.", current_text),
            "has_changes": False,
        }

    # 4. Compare
    if current_text.strip() == prev_text.strip():
        return {
            "current": {"text": current_text, "date": inkrafttreten},
            "previous": {"text": prev_text, "date": prev_page.get("inkrafttreten", ""), "nor_id": prev_nor},
            "diff_html": (
                f'<p class="diff-info">Kein Textunterschied zur Vorversion ({prev_nor}). '
                f'Reines Metadaten-Update.</p>'
                f'<div class="diff-current">{html_module.escape(current_text)}</div>'
            ),
            "has_changes": False,
        }

    # Real change!
    return {
        "current": {"text": current_text, "date": inkrafttreten, "nor_id": doc_id},
        "previous": {"text": prev_text, "date": prev_page.get("inkrafttreten", ""), "nor_id": prev_nor},
        "diff_html": _word_diff(prev_text, current_text),
        "has_changes": True,
    }


async def debug_document(gesetzesnummer: str, artikel: str) -> dict:
    """DEBUG: show what we extract from a RIS page."""
    # Use a known NOR for testing — the user can pass it via artikel
    result = {"note": "Pass a NOR number as artikel param to debug, e.g. artikel=NOR40275544"}
    nor = artikel if artikel.startswith("NOR") else ""
    if nor:
        page = await _fetch_ris_page(nor)
        if page:
            result["text_length"] = len(page["text"])
            result["text_preview"] = page["text"][:400] + "..." if len(page["text"]) > 400 else page["text"]
            result["version_nors"] = page["version_nors"]
            result["inkrafttreten"] = page.get("inkrafttreten", "")
            result["metadata"] = page.get("metadata", {})

            # Show raw HTML around "Alle Fassungen"
            raw = page.get("_raw_html", "")
            idx = raw.find("Alle Fassungen")
            if idx >= 0:
                result["html_alle_fassungen"] = raw[max(0, idx-50):idx+2000]
            else:
                result["alle_fassungen_not_found"] = True
                # Show what strings ARE in the page
                for probe in ["Fassungen", "gültig ab", "gültig von", "NOR4"]:
                    pidx = raw.find(probe)
                    result[f"probe_{probe}"] = f"found at {pidx}" if pidx >= 0 else "not found"
    return result


# ── Page fetching and parsing ──

async def _fetch_ris_page(nor_id: str) -> dict | None:
    """Fetch a RIS Dokument.wxe page and extract text + version links."""
    url = f"{_DOC_BASE}{nor_id}"
    logger.info(f"Fetching: {url}")

    async with httpx.AsyncClient(timeout=25.0, follow_redirects=True, headers=_HEADERS) as client:
        try:
            resp = await client.get(url)
            resp.raise_for_status()
            html = resp.text
            logger.info(f"Page: {len(html)} bytes")
            return _parse_page(html)
        except Exception as e:
            logger.error(f"Fetch error for {nor_id}: {e}")
            return None


def _parse_page(html: str) -> dict:
    """Parse a RIS Bundesrecht page: extract text, metadata, version NORs."""
    result = {"text": "", "version_nors": [], "metadata": {}, "_raw_html": html}

    if not html or len(html) < 200:
        return result

    # ── Extract text ──
    section_ends = [
        "Schlagworte", "Zuletzt aktualisiert",
        "Dokumentnummer", "European Legislation Identifier",
        "Navigation im Suchergebnis", "Zum Seitenanfang",
    ]
    end_pat = "|".join(re.escape(s) for s in section_ends)

    m = re.search(rf'>\s*Text\s*</[^>]+>(.*?)({end_pat})', html, re.DOTALL | re.IGNORECASE)
    if m:
        text = _clean_html(m.group(1))
        text = _remove_dupes(text)
        if len(text) > 20:
            result["text"] = text

    # Fallback: largest legal-text block
    if not result["text"]:
        blocks = re.findall(r'<(?:td|div)[^>]*>(.*?)</(?:td|div)>', html, re.DOTALL)
        best = ""
        for b in blocks:
            c = _clean_html(b)
            if len(c) > len(best) and len(c) > 100 and re.search(r'\(\d+\)|§\s*\d+', c):
                best = c
        if best:
            result["text"] = _remove_dupes(best)

    # ── Extract metadata ──
    for label, key in [("Inkrafttretensdatum", "inkrafttreten"),
                       ("Kundmachungsorgan", "bgbl")]:
        pat = rf'>\s*{re.escape(label)}\s*</[^>]+>\s*(?:<[^>]+>\s*)*([^<]+)'
        mm = re.search(pat, html, re.IGNORECASE)
        if mm:
            result[key] = html_module.unescape(mm.group(1).strip())

    # ── Extract "Alle Fassungen" NOR links ──
    # Strategy 1: Find "Alle Fassungen" section, extract NOR numbers from links after it
    nors = []
    for pattern in [
        "Alle Fassungen",
        "Alle&nbsp;Fassungen",
        "AlleFassungen",
    ]:
        idx = html.find(pattern)
        if idx >= 0:
            chunk = html[idx:idx + 5000]
            # Find all NOR numbers in href attributes
            found = re.findall(r'Dokumentnummer[=%3D]+(NOR\d+)', chunk, re.IGNORECASE)
            if found:
                nors = _dedup(found)
                logger.info(f"Alle Fassungen ({pattern}): {nors}")
                break

    # Strategy 2: Search entire page for links with "gültig" text near NOR numbers
    if not nors:
        # Find all <a> tags containing "gültig" with NOR in href
        links = re.findall(
            r'href="[^"]*Dokumentnummer[=%3D]+(NOR\d+)[^"]*"[^>]*>[^<]*(?:gültig|heute)',
            html, re.IGNORECASE
        )
        if links:
            nors = _dedup(links)
            logger.info(f"Version links (gültig pattern): {nors}")

    # Strategy 3: Find ALL NOR numbers on the page and filter to same-paragraph versions
    if not nors:
        all_nors_on_page = re.findall(r'NOR\d{8,}', html)
        if len(all_nors_on_page) > 1:
            nors = _dedup(all_nors_on_page)
            logger.info(f"All NOR numbers on page: {nors}")

    result["version_nors"] = nors
    return result


def _find_previous_nor(current_nor: str, all_nors: list[str]) -> str | None:
    """Find the NOR immediately after current_nor in the list (= previous version).
    The list is ordered newest-first from "Alle Fassungen".
    """
    if not all_nors:
        return None

    for i, nor in enumerate(all_nors):
        if nor == current_nor and i + 1 < len(all_nors):
            return all_nors[i + 1]

    # If current NOR not found in list but list has entries,
    # the first different NOR might be the previous version
    for nor in all_nors:
        if nor != current_nor:
            return nor

    return None


def _dedup(lst: list[str]) -> list[str]:
    """Deduplicate while preserving order."""
    seen = set()
    result = []
    for item in lst:
        if item not in seen:
            seen.add(item)
            result.append(item)
    return result


# ── Text processing ──

def _remove_dupes(text: str) -> str:
    """Remove RIS accessible text duplications."""
    text = re.sub(r'(§\s*\d+[a-z]?\.?)\s*Paragraph\s*\d+[a-z]?,?\s*', r'\1 ', text)
    text = re.sub(
        r'(\(\d+[a-z]?\))\s*Absatz\s*(?:eins|zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn|\d+\s*[a-z]?),?\s*',
        r'\1 ', text)
    text = re.sub(r'Anmerkung,?\s*aus Bundesgesetzblatt[^)]*\)\s*', '', text)
    text = re.sub(r'\bParagraph\s+\d+\s*[a-z]?,\s*', '', text)
    text = re.sub(r'\bAbsatz\s+\d+\s*[a-z]?,\s*', '', text)
    text = re.sub(r'\bZiffer\s+(?:eins|zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn|\d+)\s*', '', text)
    text = re.sub(r'\bLitera\s+[a-z]\s*', '', text)
    text = re.sub(r'  +', ' ', text)
    return text.strip()


def _word_diff(old: str, new: str) -> str:
    ow, nw = old.split(), new.split()
    if not ow and not nw:
        return '<p class="diff-info">Beide Versionen sind leer.</p>'
    sm = difflib.SequenceMatcher(None, ow, nw)
    parts = []
    for op, i1, i2, j1, j2 in sm.get_opcodes():
        if op == "equal":
            parts.append(html_module.escape(" ".join(ow[i1:i2])))
        elif op == "delete":
            parts.append(f'<span class="diff-del">{html_module.escape(" ".join(ow[i1:i2]))}</span>')
        elif op == "insert":
            parts.append(f'<span class="diff-ins">{html_module.escape(" ".join(nw[j1:j2]))}</span>')
        elif op == "replace":
            parts.append(f'<span class="diff-del">{html_module.escape(" ".join(ow[i1:i2]))}</span>')
            parts.append(f'<span class="diff-ins">{html_module.escape(" ".join(nw[j1:j2]))}</span>')
    return " ".join(parts)


def _no_prev_html(msg: str, text: str) -> str:
    return (f'<p class="diff-info">{html_module.escape(msg)}</p>'
            f'<div class="diff-current">{html_module.escape(text)}</div>')


def _error(msg: str) -> dict:
    return {"current": None, "previous": None,
            "diff_html": f'<p class="diff-info">{html_module.escape(msg)}</p>',
            "has_changes": False}


def _clean_html(text: str) -> str:
    c = re.sub(r'<(script|style|noscript)[^>]*>.*?</\1>', '', text, flags=re.DOTALL | re.IGNORECASE)
    c = re.sub(r'<(?:br|/p|/div|/tr|/li)\s*/?>', '\n', c, flags=re.IGNORECASE)
    c = re.sub(r'<[^>]+>', ' ', c)
    c = html_module.unescape(c)
    c = re.sub(r'[ \t]+', ' ', c)
    c = re.sub(r'\n[ \t]+', '\n', c)
    c = re.sub(r'\n{3,}', '\n\n', c)
    return c.strip()
