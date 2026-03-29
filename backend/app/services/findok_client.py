"""Findok (Finanzdokumentation) client — BMF Austria tax law database.

Findok has no public REST API. We scrape the "Neu in Findok" page and
search the Findok web application to find recent BMF directives/decrees.

Content types: Richtlinien, Erlässe, Informationen, EAS
URL: https://findok.bmf.gv.at/
"""

import logging
import re
from datetime import date, timedelta

import httpx

logger = logging.getLogger(__name__)

_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "text/html, application/xhtml+xml, */*",
}

FINDOK_BASE = "https://findok.bmf.gv.at"


async def search_findok(im_ris_seit: str = "EinemMonat") -> list[dict]:
    """Fetch recent Findok entries (BMF Richtlinien, Erlässe, EAS).

    Scrapes the Findok landing page which shows "Neu in Findok" items.
    Returns a list of result dicts compatible with the report pipeline.
    """
    results = []

    async with httpx.AsyncClient(
        timeout=20.0, follow_redirects=True, headers=_HEADERS
    ) as client:
        try:
            # The Findok landing page shows recent items
            resp = await client.get(f"{FINDOK_BASE}/")
            resp.raise_for_status()
            html = resp.text
        except Exception as e:
            logger.error(f"Findok fetch error: {e}")
            return []

    # Parse "Neu in Findok" entries from the HTML
    # Findok lists items with links like /findok/?stammNr=XXXXX
    import html as html_mod

    # Find all links with stammNr
    pattern = re.compile(
        r'<a[^>]*href="(/findok/\?[^"]*stammNr=(\d+)[^"]*)"[^>]*>(.*?)</a>',
        re.DOTALL | re.IGNORECASE,
    )

    seen = set()
    for match in pattern.finditer(html):
        link_path = match.group(1)
        stamm_nr = match.group(2)
        raw_title = match.group(3)

        if stamm_nr in seen:
            continue
        seen.add(stamm_nr)

        # Clean title
        title = re.sub(r"<[^>]+>", " ", raw_title)
        title = html_mod.unescape(title)
        title = re.sub(r"\s+", " ", title).strip()

        if not title or len(title) < 5:
            continue

        # Determine type from title/context
        typ = "BMF"
        for keyword, label in [
            ("Richtlinie", "Richtlinie"),
            ("Erlass", "Erlass"),
            ("EAS", "EAS"),
            ("Information", "Information"),
            ("Salzburger Steuerdialog", "Steuerdialog"),
        ]:
            if keyword.lower() in title.lower():
                typ = label
                break

        results.append({
            "id": f"FINDOK_{stamm_nr}",
            "title": title,
            "long_title": title,
            "url": f"{FINDOK_BASE}{link_path}",
            "date": date.today().strftime("%Y-%m-%d"),
            "bgbl": "",
            "typ": typ,
            "artikel": "",
            "source": "findok",
            "gesetzesnummer": "",
            "materialien": "",
        })

    logger.info(f"Findok: found {len(results)} entries")
    return results[:30]


async def fetch_findok_document(stamm_nr: str) -> dict:
    """Fetch a single Findok document by its stammNr."""
    url = f"{FINDOK_BASE}/findok/?stammNr={stamm_nr}"

    async with httpx.AsyncClient(
        timeout=15.0, follow_redirects=True, headers=_HEADERS
    ) as client:
        try:
            resp = await client.get(url)
            resp.raise_for_status()
            html = resp.text
        except Exception as e:
            logger.error(f"Findok doc error: {e}")
            return {"stamm_nr": stamm_nr, "text": "", "url": url}

    import html as html_mod

    # Extract main content text
    # Remove scripts and styles
    clean = re.sub(r"<(script|style)[^>]*>.*?</\1>", "", html, flags=re.DOTALL | re.IGNORECASE)
    # Remove nav/header/footer if possible
    clean = re.sub(r"<(nav|header|footer)[^>]*>.*?</\1>", "", clean, flags=re.DOTALL | re.IGNORECASE)
    clean = re.sub(r"<[^>]+>", " ", clean)
    clean = html_mod.unescape(clean)
    clean = re.sub(r"\s+", " ", clean).strip()

    return {
        "stamm_nr": stamm_nr,
        "text": clean[:3000],
        "url": url,
    }
