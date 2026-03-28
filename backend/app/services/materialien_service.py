"""Service for fetching Gesetzesmaterialien (Erläuterungen) from parlament.gv.at.

Workflow per BGBl number:
1. Parse BGBl string → extract number and year (e.g. "BGBl. I Nr. 6/2026" → 6, 2026)
2. Search RIS BgblAuth API to find the Materialienzeile (GP, RV number)
3. Fetch parlament.gv.at JSON page for the Regierungsvorlage
4. Extract Erläuterungen title + PDF link
"""

import logging
import re

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "application/json, text/html",
}

# Map GP numbers to Roman numerals
_GP_MAP = {
    "28": "XXVIII", "27": "XXVII", "26": "XXVI", "25": "XXV",
    "24": "XXIV", "23": "XXIII", "22": "XXII",
}


async def fetch_materialien_for_bgbl(bgbl_str: str) -> dict | None:
    """Fetch parliamentary materials (Erläuterungen) for a BGBl number.

    Returns: {
        "bgbl": "BGBl. I Nr. 6/2026",
        "rv_nr": "301",
        "gp": "XXVIII",
        "titel": "Gesellschaftsrechts-Änderungsgesetz 2026",
        "erlaeuterungen_url": "https://www.parlament.gv.at/...",
        "parlament_url": "https://www.parlament.gv.at/gegenstand/XXVIII/I/301",
    }
    """
    if not bgbl_str:
        return None

    # Step 1: Parse BGBl number
    bgbl_match = re.search(r'Nr\.?\s*(\d+)/(\d{4})', bgbl_str)
    if not bgbl_match:
        return None
    bgbl_nr = bgbl_match.group(1)
    bgbl_year = bgbl_match.group(2)
    logger.info(f"Materialien: BGBl Nr. {bgbl_nr}/{bgbl_year}")

    # Step 2: Search RIS BgblAuth for the Materialienzeile
    gp, rv_nr = await _find_rv_from_ris(bgbl_nr, bgbl_year)

    if not gp or not rv_nr:
        # Try parlament.gv.at direct search as fallback
        return await _search_parlament_direct(bgbl_str, bgbl_nr, bgbl_year)

    # Step 3: Fetch parlament.gv.at JSON page
    return await _fetch_parlament_page(gp, rv_nr, bgbl_str)


async def _find_rv_from_ris(bgbl_nr: str, bgbl_year: str) -> tuple[str, str]:
    """Find GP and RV number from RIS BgblAuth API."""
    url = f"{settings.RIS_API_BASE_URL}/Bundesrecht"
    params = {
        "Applikation": "BgblAuth",
        "Kundmachungsorgannummer": f"{bgbl_nr}/{bgbl_year}",
        "DokumenteProSeite": "Ten",
    }

    async with httpx.AsyncClient(timeout=15.0) as client:
        try:
            resp = await client.get(url, params=params)
            resp.raise_for_status()
            data = resp.json()
        except Exception as e:
            logger.error(f"RIS BgblAuth error: {e}")
            return "", ""

    refs = data.get("OgdSearchResult", {}).get("OgdDocumentResults", {}).get("OgdDocumentReference", [])
    if isinstance(refs, dict):
        refs = [refs]
    if not refs:
        return "", ""

    # Look for Materialienzeile in the metadata or content
    for ref in refs:
        d = ref.get("Data", {})
        m = d.get("Metadaten", {})

        # Flatten metadata
        flat = {}
        for section_key in ("Technisch", "Allgemein", "Bundesrecht", "BgblAuth"):
            section = m.get(section_key)
            if isinstance(section, list) and section:
                section = section[0]
            if isinstance(section, dict):
                flat.update(section)

        # Check for Materialien/NR field
        materialien = flat.get("Materialien", "") or flat.get("NR", "") or flat.get("Parlamentarisch", "")
        if materialien:
            gp, rv = _parse_materialien(str(materialien))
            if gp and rv:
                return gp, rv

    # If no Materialienzeile found, try to guess GP from year
    gp_guess = _guess_gp(bgbl_year)
    return gp_guess, ""


def _parse_materialien(text: str) -> tuple[str, str]:
    """Parse a Materialienzeile to extract GP and RV number."""
    # Pattern: "NR: GP XXVIII RV 301 AB 389 S. 52."
    # or "GP XXVII RV 2261 AB 2319"
    m = re.search(r'GP\s+([IVXLC]+)\s+(?:RV|IA)\s+(\d+)', text)
    if m:
        return m.group(1), m.group(2)

    # Pattern: "(NR: GP XXVIII 301 AB 389 S. 52.)"
    m = re.search(r'GP\s+([IVXLC]+)\s+(\d+)', text)
    if m:
        return m.group(1), m.group(2)

    return "", ""


def _guess_gp(year: str) -> str:
    """Guess the Gesetzgebungsperiode from the BGBl year."""
    y = int(year) if year.isdigit() else 0
    if y >= 2024:
        return "XXVIII"
    if y >= 2019:
        return "XXVII"
    if y >= 2017:
        return "XXVI"
    if y >= 2013:
        return "XXV"
    return "XXVIII"


async def _fetch_parlament_page(gp: str, rv_nr: str, bgbl_str: str) -> dict | None:
    """Fetch the parlament.gv.at JSON page for a Regierungsvorlage."""
    url = f"https://www.parlament.gv.at/gegenstand/{gp}/I/{rv_nr}"
    json_url = f"{url}?json=true"

    logger.info(f"Fetching parlament.gv.at: {json_url}")

    async with httpx.AsyncClient(timeout=15.0, follow_redirects=True, headers=_HEADERS) as client:
        try:
            resp = await client.get(json_url)
            resp.raise_for_status()
            data = resp.json()
        except Exception as e:
            logger.error(f"parlament.gv.at error: {e}")
            return {
                "bgbl": bgbl_str,
                "rv_nr": rv_nr,
                "gp": gp,
                "titel": "",
                "erlaeuterungen_url": "",
                "parlament_url": url,
            }

    # Extract title
    titel = data.get("title", "") or data.get("content", {}).get("title", "")

    # Find Erläuterungen document
    erl_url = ""
    documents = data.get("content", {}).get("documents", [])
    if isinstance(documents, list):
        for doc_group in documents:
            if isinstance(doc_group, dict):
                group_title = doc_group.get("title", "").lower()
                if "erläuterung" in group_title or "erlaeuterung" in group_title:
                    docs = doc_group.get("documents", [])
                    if isinstance(docs, list) and docs:
                        link = docs[0].get("link", "")
                        if link:
                            erl_url = f"https://www.parlament.gv.at{link}" if link.startswith("/") else link
                    break

    return {
        "bgbl": bgbl_str,
        "rv_nr": rv_nr,
        "gp": gp,
        "titel": titel,
        "erlaeuterungen_url": erl_url,
        "parlament_url": url,
    }


async def _search_parlament_direct(bgbl_str: str, bgbl_nr: str, bgbl_year: str) -> dict | None:
    """Fallback: try to find RV on parlament.gv.at by searching."""
    gp = _guess_gp(bgbl_year)
    return {
        "bgbl": bgbl_str,
        "rv_nr": "",
        "gp": gp,
        "titel": "",
        "erlaeuterungen_url": "",
        "parlament_url": f"https://www.parlament.gv.at/recherchieren/verhandlungsgegenstande/?GP={gp}&VHG=RV",
    }


async def fetch_materialien_for_results(results: list[dict]) -> dict[str, dict]:
    """Fetch Materialien for all unique BGBl numbers in search results.

    Groups results by BGBl, fetches Materialien for each unique BGBl.
    Returns: { bgbl_key: materialien_dict }
    """
    import asyncio

    # Extract unique BGBl numbers
    bgbl_set = {}
    for r in results:
        bgbl = r.get("bgbl", "")
        if bgbl and "BGBl" in bgbl:
            # Normalize: extract the core "Nr. X/YYYY" part
            m = re.search(r'Nr\.?\s*\d+/\d{4}', bgbl)
            if m:
                key = m.group(0)
                if key not in bgbl_set:
                    bgbl_set[key] = bgbl

    if not bgbl_set:
        return {}

    logger.info(f"Fetching Materialien for {len(bgbl_set)} unique BGBl numbers")

    # Fetch all in parallel (max 10)
    tasks = [fetch_materialien_for_bgbl(bgbl) for bgbl in list(bgbl_set.values())[:10]]
    results_mat = await asyncio.gather(*tasks, return_exceptions=True)

    materialien = {}
    for key, result in zip(bgbl_set.keys(), results_mat):
        if isinstance(result, dict):
            materialien[key] = result

    return materialien
