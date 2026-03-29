"""Findok (Finanzdokumentation) client — BMF Austria tax law database.

Access methods (IWG 2022 compliant):
1. Bestandslisten: findok.bmf.gv.at/findok/bestandlisten — weekly XML/ZIP
2. "Neu in Findok" landing page: findok.bmf.gv.at/ — latest items
3. Individual docs: findok.bmf.gv.at/findok/?stammNr=XXXXX
4. Richtlinien index: findok.bmf.gv.at/findok/richtlinien
5. Volltext search: findok.bmf.gv.at/findok/volltext(suche:Standardsuche)?...

Content types: Richtlinien, Erlässe, Informationen, EAS, BFG, UFS
License: CC0 (Creative Commons Zero)
XML updated weekly: Thursday/Friday night
"""

import logging
import re
from datetime import date, timedelta

import httpx

logger = logging.getLogger(__name__)

_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "text/html, application/xhtml+xml, application/xml, */*",
}

FINDOK_BASE = "https://findok.bmf.gv.at"

# Known Bestandslisten pages (IWG 2022)
_BESTANDSLISTEN = {
    "richtlinien": f"{FINDOK_BASE}/findok/bestandlisten?typ=RICHTLINIE",
    "erlaesse": f"{FINDOK_BASE}/findok/bestandlisten?typ=ERLASS",
    "eas": f"{FINDOK_BASE}/findok/bestandlisten?typ=EAS",
    "bfg": f"{FINDOK_BASE}/findok/bestandlisten?typ=BFG",
    "amtlich": f"{FINDOK_BASE}/findok/bestandlisten?typ=AMTLICH",
}


async def search_findok(im_ris_seit: str = "EinemMonat") -> list[dict]:
    """Fetch recent Findok entries (BMF Richtlinien, Erlässe, EAS, BFG).

    Strategy:
    1. Fetch "Neu in Findok" landing page for latest items
    2. Fetch Bestandslisten overview for structured inventory
    3. Parse document links, titles, dates, types

    Returns a list of result dicts compatible with the report pipeline.
    """
    import html as html_mod

    results = []
    seen = set()

    async with httpx.AsyncClient(
        timeout=25.0, follow_redirects=True, headers=_HEADERS
    ) as client:
        # ── 1. "Neu in Findok" landing page (most recent items) ──
        try:
            resp = await client.get(f"{FINDOK_BASE}/")
            resp.raise_for_status()
            _parse_findok_links(resp.text, results, seen)
            logger.info(f"Findok landing: {len(results)} items")
        except Exception as e:
            logger.error(f"Findok landing page error: {e}")

        # ── 2. Bestandslisten page (structured inventory) ──
        try:
            resp = await client.get(f"{FINDOK_BASE}/findok/bestandlisten")
            resp.raise_for_status()
            _parse_findok_links(resp.text, results, seen)
            logger.info(f"Findok bestandlisten: total {len(results)} items")
        except Exception as e:
            logger.error(f"Findok bestandlisten error: {e}")

        # ── 3. Richtlinien index (current directives) ──
        try:
            resp = await client.get(f"{FINDOK_BASE}/findok/richtlinien")
            resp.raise_for_status()
            _parse_findok_links(resp.text, results, seen)
            logger.info(f"Findok richtlinien: total {len(results)} items")
        except Exception as e:
            logger.error(f"Findok richtlinien error: {e}")

    logger.info(f"Findok: {len(results)} total entries found")
    return results[:50]


def _parse_findok_links(html: str, results: list, seen: set):
    """Parse Findok HTML page for document links."""
    import html as html_mod

    # Pattern 1: Links with stammNr parameter
    pattern_stamm = re.compile(
        r'<a[^>]*href="([^"]*(?:stammNr|dokumentId)=([a-zA-Z0-9\-]+)[^"]*)"[^>]*>(.*?)</a>',
        re.DOTALL | re.IGNORECASE,
    )

    for match in pattern_stamm.finditer(html):
        link_path = match.group(1)
        doc_id = match.group(2)
        raw_title = match.group(3)

        if doc_id in seen:
            continue
        seen.add(doc_id)

        # Clean title
        title = re.sub(r"<[^>]+>", " ", raw_title)
        title = html_mod.unescape(title)
        title = re.sub(r"\s+", " ", title).strip()

        if not title or len(title) < 5:
            continue

        # Build full URL
        if link_path.startswith("http"):
            full_url = link_path
        elif link_path.startswith("/"):
            full_url = f"{FINDOK_BASE}{link_path}"
        else:
            full_url = f"{FINDOK_BASE}/findok/{link_path}"

        # Determine type from title/URL context
        typ = _detect_type(title, link_path)

        # Try to extract date from surrounding context
        doc_date = _extract_date_near(html, match.start(), match.end())

        results.append({
            "id": f"FINDOK_{doc_id}",
            "title": title,
            "long_title": title,
            "url": full_url,
            "date": doc_date or date.today().strftime("%Y-%m-%d"),
            "bgbl": "",
            "typ": typ,
            "artikel": "",
            "source": "findok",
            "gesetzesnummer": "",
            "materialien": "",
        })


def _detect_type(title: str, url: str) -> str:
    """Detect Findok document type from title and URL."""
    combined = (title + " " + url).lower()
    for keyword, label in [
        ("richtlinie", "Richtlinie"),
        ("erlass", "Erlass"),
        ("eas", "EAS"),
        ("information", "Information"),
        ("bfg", "BFG"),
        ("ufs", "UFS"),
        ("steuerdialog", "Steuerdialog"),
        ("wartungserlass", "Wartungserlass"),
        ("bundesfinanzgericht", "BFG"),
        ("bmf-av", "BMF-AV"),
    ]:
        if keyword in combined:
            return label
    return "BMF"


def _extract_date_near(html: str, start: int, end: int) -> str:
    """Try to find a date pattern near a match position in HTML."""
    # Look in a window around the match
    window = html[max(0, start - 200):min(len(html), end + 200)]
    # ISO date
    m = re.search(r'(\d{4}-\d{2}-\d{2})', window)
    if m:
        return m.group(1)
    # German date (dd.mm.yyyy)
    m = re.search(r'(\d{2})\.(\d{2})\.(\d{4})', window)
    if m:
        return f"{m.group(3)}-{m.group(2)}-{m.group(1)}"
    return ""


async def fetch_findok_document(doc_id: str) -> dict:
    """Fetch a single Findok document by stammNr or dokumentId."""
    # Try stammNr first, then dokumentId
    if doc_id.isdigit():
        url = f"{FINDOK_BASE}/findok/?stammNr={doc_id}"
    else:
        url = f"{FINDOK_BASE}/findok/volltext(suche:Standardsuche)?dokumentId={doc_id}"

    async with httpx.AsyncClient(
        timeout=20.0, follow_redirects=True, headers=_HEADERS
    ) as client:
        try:
            resp = await client.get(url)
            resp.raise_for_status()
            raw = resp.text
        except Exception as e:
            logger.error(f"Findok doc error for {doc_id}: {e}")
            return {"doc_id": doc_id, "text": "", "url": url}

    import html as html_mod

    # Extract main content
    clean = re.sub(r"<(script|style|nav|header|footer)[^>]*>.*?</\1>", "", raw,
                   flags=re.DOTALL | re.IGNORECASE)
    clean = re.sub(r"<[^>]+>", " ", clean)
    clean = html_mod.unescape(clean)
    clean = re.sub(r"\s+", " ", clean).strip()

    return {
        "doc_id": doc_id,
        "text": clean[:3000],
        "url": url,
    }
