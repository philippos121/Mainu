"""Service for fetching and comparing versions of RIS Bundesrecht provisions.

Correct approach:
1. Fetch current text from the RIS website using the specific NOR from search results.
2. Fetch previous text using the same NOR page + FassungVom URL parameter
   (Inkrafttretensdatum - 1 day). The RIS website shows the version that was
   valid on that date.
3. Compare the two texts with word-level diff.

Key insight: The BrKons API always returns the same consolidated NOR number
regardless of FassungVom. So we CANNOT compare NOR numbers to detect changes.
We must compare actual TEXT CONTENT.
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

_RIS_DOC_BASE = "https://www.ris.bka.gv.at/Dokument.wxe?Abfrage=Bundesnormen"


async def fetch_provision_diff(
    doc_id: str,
    gesetzesnummer: str,
    artikel: str,
    inkrafttreten: str,
) -> dict:
    """Fetch current + previous version and return diff.

    Uses the RIS website with &FassungVom parameter to get historical versions.
    """
    logger.info(f"=== DIFF: NOR={doc_id}, GesNr={gesetzesnummer}, Art={artikel}, Inkraft={inkrafttreten}")

    if not doc_id:
        return _error_result("Dokumentnummer (NOR) fehlt.")

    # 1. Fetch CURRENT text from the specific NOR page
    current_url = f"{_RIS_DOC_BASE}&Dokumentnummer={doc_id}"
    current_text = await _fetch_text_from_url(current_url)
    if not current_text:
        return _error_result(f"Text für {doc_id} konnte nicht geladen werden.")

    # 2. Compute FassungVom = Inkrafttretensdatum - 1 day
    fassung_vom = _day_before(inkrafttreten)
    if not fassung_vom:
        return {
            "current": {"text": current_text, "date": inkrafttreten, "nor_id": doc_id},
            "previous": None,
            "diff_html": _no_previous_html("Inkrafttretensdatum konnte nicht geparst werden.", current_text),
            "has_changes": False,
        }

    # 3. Fetch PREVIOUS text using same NOR + FassungVom
    #    The RIS website shows the version valid on the given date.
    prev_url = f"{_RIS_DOC_BASE}&Dokumentnummer={doc_id}&FassungVom={fassung_vom}"
    logger.info(f"Fetching previous version: {prev_url}")
    prev_text = await _fetch_text_from_url(prev_url)

    # 4. If previous text is empty, try with Gesetzesnummer + Paragraf on RIS search
    if not prev_text and gesetzesnummer and artikel:
        paragraf = artikel.replace("§", "").strip()
        prev_url2 = (
            f"https://www.ris.bka.gv.at/NormDokument.wxe"
            f"?Abfrage=Bundesnormen&Gesetzesnummer={gesetzesnummer}"
            f"&Paragraf={paragraf}&FassungVom={fassung_vom}"
        )
        logger.info(f"Fallback: {prev_url2}")
        prev_text = await _fetch_text_from_url(prev_url2)

    # 5. Compare
    if not prev_text:
        return {
            "current": {"text": current_text, "date": inkrafttreten, "nor_id": doc_id},
            "previous": None,
            "diff_html": _no_previous_html(
                f"Keine Fassung für den {fassung_vom} verfügbar — "
                "möglicherweise die Erstfassung.", current_text
            ),
            "has_changes": False,
        }

    if current_text.strip() == prev_text.strip():
        return {
            "current": {"text": current_text, "date": inkrafttreten, "nor_id": doc_id},
            "previous": None,
            "diff_html": (
                f'<p class="diff-info">Kein Textunterschied zwischen der aktuellen '
                f'Fassung und der Fassung vom {fassung_vom}. Reines RIS-Metadaten-Update.</p>'
                f'<div class="diff-current">{html_module.escape(current_text)}</div>'
            ),
            "has_changes": False,
        }

    # Real change!
    diff_html = _compute_word_diff(prev_text, current_text)
    return {
        "current": {"text": current_text, "date": inkrafttreten, "nor_id": doc_id},
        "previous": {"text": prev_text, "date": f"Fassung vom {fassung_vom}"},
        "diff_html": diff_html,
        "has_changes": True,
    }


async def debug_document(gesetzesnummer: str, artikel: str) -> dict:
    """DEBUG endpoint."""
    from app.core.config import settings
    result = {}

    # Try API query
    params = {
        "Applikation": "BrKons",
        "Gesetzesnummer": gesetzesnummer,
        "ArtikelParagraphAnlage": artikel,
        "DokumenteProSeite": "Ten",
    }
    url = f"{settings.RIS_API_BASE_URL}/Bundesrecht"
    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            resp = await client.get(url, params=params)
            data = resp.json()
            refs = data.get("OgdSearchResult", {}).get("OgdDocumentResults", {}).get("OgdDocumentReference", [])
            if isinstance(refs, dict):
                refs = [refs]
            result["api_hits"] = len(refs)
            if refs:
                ref = refs[0]
                d = ref.get("Data", {})
                m = d.get("Metadaten", {})
                result["api_data_keys"] = list(d.keys())
                result["api_meta_keys"] = list(m.keys())
                # Flatten
                flat = {}
                for k in ("Technisch", "Allgemein", "Bundesrecht"):
                    s = m.get(k)
                    if isinstance(s, list) and s:
                        s = s[0]
                    if isinstance(s, dict):
                        flat.update(s)
                        for sk in ("BrKons",):
                            ss = s.get(sk)
                            if isinstance(ss, list) and ss:
                                ss = ss[0]
                            if isinstance(ss, dict):
                                flat.update(ss)
                result["flat_metadata"] = {k: str(v)[:200] for k, v in flat.items()}
        except Exception as e:
            result["api_error"] = str(e)

    return result


# ── Text fetching ──

async def _fetch_text_from_url(url: str) -> str:
    """Fetch a RIS website page and extract the legal text."""
    logger.info(f"Fetching: {url}")
    async with httpx.AsyncClient(timeout=25.0, follow_redirects=True, headers=_HEADERS) as client:
        try:
            resp = await client.get(url)
            resp.raise_for_status()
            text = _extract_text_from_page(resp.text)
            text = _remove_accessible_duplicates(text)
            logger.info(f"Extracted: {len(text)} chars from {url}")
            return text
        except Exception as e:
            logger.error(f"Fetch error: {e}")
            return ""


def _extract_text_from_page(page_html: str) -> str:
    """Extract legal text from a RIS website page."""
    if not page_html or len(page_html) < 200:
        return ""

    # Strategy 1: Find >Text</tag> then content until next section
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

    # Strategy 2: Largest block with legal patterns
    blocks = re.findall(r'<(?:td|div)[^>]*>(.*?)</(?:td|div)>', page_html, re.DOTALL)
    best = ""
    for block in blocks:
        cleaned = _clean_html(block)
        if len(cleaned) > len(best) and len(cleaned) > 100:
            if re.search(r'\(\d+\)|§\s*\d+|Abs\.|Absatz', cleaned):
                best = cleaned
    return best


# ── Text processing ──

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


def _no_previous_html(msg: str, current_text: str) -> str:
    return (
        f'<p class="diff-info">{html_module.escape(msg)}</p>'
        f'<div class="diff-current">{html_module.escape(current_text)}</div>'
    )


def _error_result(msg: str) -> dict:
    return {
        "current": None, "previous": None,
        "diff_html": f'<p class="diff-info">{html_module.escape(msg)}</p>',
        "has_changes": False,
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
