"""Service for fetching and comparing versions of RIS Bundesrecht provisions.

Approach:
1. Use RIS API with Fassung.VonInkrafttretensdatum / BisInkrafttretensdatum
   range queries to find all versions of a provision within a date range.
2. Each version has its own NOR number, Inkrafttretensdatum, Ausserkrafttretensdatum.
3. Find the current version + the version immediately before it.
4. Fetch text for both from the RIS website (NOR-specific pages).
5. Compute word-level diff.
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
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "de-AT,de;q=0.9,en;q=0.5",
}

BASE_URL = settings.RIS_API_BASE_URL
_DOC_URL = "https://www.ris.bka.gv.at/Dokument.wxe?Abfrage=Bundesnormen&Dokumentnummer="


async def fetch_provision_diff(
    doc_id: str,
    gesetzesnummer: str,
    artikel: str,
    inkrafttreten: str,
) -> dict:
    """Fetch current + previous version and return diff."""
    logger.info(f"=== DIFF: NOR={doc_id}, GesNr={gesetzesnummer}, Art={artikel}, Inkraft={inkrafttreten}")

    if not gesetzesnummer or not artikel:
        return _error("Gesetzesnummer und Artikel fehlen.")

    # 1. Find all versions via API (search wide range: 20 years back)
    versions = await _find_all_versions(gesetzesnummer, artikel)
    logger.info(f"Found {len(versions)} versions")

    if not versions:
        return _error("Keine Versionen via API gefunden.")

    # 2. Find the current version and the one before it
    current_v = None
    prev_v = None

    # Try to match by NOR number first
    for i, v in enumerate(versions):
        if v["nor"] == doc_id:
            current_v = v
            if i + 1 < len(versions):
                prev_v = versions[i + 1]
            break

    # If NOR not found, match by Inkrafttretensdatum
    if not current_v and inkrafttreten:
        for i, v in enumerate(versions):
            if v["inkrafttreten"] == inkrafttreten:
                current_v = v
                if i + 1 < len(versions):
                    prev_v = versions[i + 1]
                break

    # Fallback: just use first two
    if not current_v and versions:
        current_v = versions[0]
        if len(versions) > 1:
            prev_v = versions[1]

    if not current_v:
        return _error("Aktuelle Version konnte nicht identifiziert werden.")

    # 3. Fetch text for current version
    current_text = await _fetch_text_for_nor(current_v["nor"])
    if not current_text:
        return _error(f"Text für {current_v['nor']} konnte nicht geladen werden.")

    if not prev_v:
        return {
            "current": {"text": current_text, "date": current_v["inkrafttreten"], "nor_id": current_v["nor"],
                        "info": current_v.get("bgbl", "")},
            "previous": None,
            "diff_html": _no_prev("Keine Vorversion gefunden — Erstfassung.", current_text),
            "has_changes": False,
        }

    # 4. Fetch text for previous version
    prev_text = await _fetch_text_for_nor(prev_v["nor"])
    if not prev_text:
        return {
            "current": {"text": current_text, "date": current_v["inkrafttreten"], "nor_id": current_v["nor"],
                        "info": current_v.get("bgbl", "")},
            "previous": None,
            "diff_html": _no_prev(f"Text der Vorversion ({prev_v['nor']}) nicht ladbar.", current_text),
            "has_changes": False,
        }

    # 5. Compare
    if current_text.strip() == prev_text.strip():
        return {
            "current": {"text": current_text, "date": current_v["inkrafttreten"], "nor_id": current_v["nor"]},
            "previous": {"text": prev_text, "date": prev_v["inkrafttreten"], "nor_id": prev_v["nor"]},
            "diff_html": (
                f'<p class="diff-info">Identischer Text mit Vorversion ({prev_v["nor"]}). '
                'Möglicherweise nur redaktionelle/formale Änderung.</p>'
                f'<div class="diff-current">{html_module.escape(current_text)}</div>'
            ),
            "has_changes": False,
        }

    return {
        "current": {"text": current_text, "date": current_v["inkrafttreten"], "nor_id": current_v["nor"],
                    "info": current_v.get("bgbl", "")},
        "previous": {"text": prev_text, "date": prev_v["inkrafttreten"], "nor_id": prev_v["nor"],
                      "info": prev_v.get("bgbl", "")},
        "diff_html": _word_diff(prev_text, current_text),
        "has_changes": True,
    }


async def debug_document(gesetzesnummer: str, artikel: str) -> dict:
    """DEBUG: show all versions found by API for a provision."""
    if not gesetzesnummer:
        return {"error": "gesetzesnummer required"}

    versions = await _find_all_versions(gesetzesnummer, artikel)
    return {
        "versions_count": len(versions),
        "versions": versions,
    }


# ── API: find all versions ──

async def _find_all_versions(gesetzesnummer: str, artikel: str) -> list[dict]:
    """Query API to find all versions of a provision, ordered newest-first.

    Uses Fassung.VonInkrafttretensdatum with a wide range to get all historical versions.
    """
    # Search from 1800 to 2100 to get everything
    params = {
        "Applikation": "BrKons",
        "Gesetzesnummer": gesetzesnummer,
        "ArtikelParagraphAnlage": artikel,
        "Fassung.VonInkrafttretensdatum": "1800-01-01",
        "Fassung.BisInkrafttretensdatum": "2100-12-31",
        "DokumenteProSeite": "OneHundred",
        "Seitennummer": "1",
    }

    url = f"{BASE_URL}/Bundesrecht"
    logger.info(f"API versions query: {params}")

    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            resp = await client.get(url, params=params)
            resp.raise_for_status()
            data = resp.json()
        except Exception as e:
            logger.error(f"API error: {e}")
            return []

    refs = _extract_refs(data)
    logger.info(f"API returned {len(refs)} refs")

    versions = []
    for ref in refs:
        d = ref.get("Data", {})
        m = _flatten_meta(d)

        nor = _s(m.get("ID")) or _s(m.get("Dokumentnummer")) or _s(d.get("Dokumentnummer")) or ""
        inkraft = _s(m.get("Inkrafttretensdatum")) or ""
        ausserkraft = _s(m.get("Ausserkrafttretensdatum")) or ""
        bgbl = _s(m.get("Kundmachungsorgan")) or ""

        if nor:
            versions.append({
                "nor": nor,
                "inkrafttreten": inkraft,
                "ausserkrafttreten": ausserkraft,
                "bgbl": bgbl,
            })

    # Sort by Inkrafttretensdatum descending (newest first)
    versions.sort(key=lambda v: v["inkrafttreten"], reverse=True)

    return versions


# ── Text fetching from RIS website ──

async def _fetch_text_for_nor(nor_id: str) -> str:
    """Fetch legal text for a specific NOR from the RIS website."""
    url = f"{_DOC_URL}{nor_id}"
    logger.info(f"Fetching text: {url}")

    async with httpx.AsyncClient(timeout=25.0, follow_redirects=True, headers=_HEADERS) as client:
        try:
            resp = await client.get(url)
            resp.raise_for_status()
            text = _extract_text(resp.text)
            text = _remove_dupes(text)
            logger.info(f"Text for {nor_id}: {len(text)} chars")
            return text
        except Exception as e:
            logger.error(f"Fetch error {nor_id}: {e}")
            return ""


def _extract_text(html: str) -> str:
    """Extract legal text section from RIS page."""
    if not html or len(html) < 200:
        return ""

    ends = ["Schlagworte", "Zuletzt aktualisiert", "Dokumentnummer",
            "European Legislation Identifier", "Navigation im Suchergebnis", "Zum Seitenanfang"]
    end_pat = "|".join(re.escape(s) for s in ends)

    m = re.search(rf'>\s*Text\s*</[^>]+>(.*?)({end_pat})', html, re.DOTALL | re.IGNORECASE)
    if m:
        text = _clean_html(m.group(1))
        if len(text) > 20:
            return text

    # Fallback
    blocks = re.findall(r'<(?:td|div)[^>]*>(.*?)</(?:td|div)>', html, re.DOTALL)
    best = ""
    for b in blocks:
        c = _clean_html(b)
        if len(c) > len(best) and len(c) > 100 and re.search(r'\(\d+\)|§\s*\d+', c):
            best = c
    return best


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
            for sub in ("BrKons",):
                s = section.get(sub)
                if isinstance(s, list) and s:
                    s = s[0]
                if isinstance(s, dict):
                    merged.update(s)
    return merged


def _s(val) -> str:
    if val is None:
        return ""
    if isinstance(val, str):
        return val
    if isinstance(val, list):
        return ", ".join(str(v) for v in val)
    return str(val)


# ── Text processing ──

def _remove_dupes(text: str) -> str:
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


def _no_prev(msg: str, text: str) -> str:
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
