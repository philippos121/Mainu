"""Service for fetching Gesetzesmaterialien (Erläuterungen) from parlament.gv.at.

Two approaches to find GP + RV number:
1. From the "Gesetzesmaterialien" field in BrKons metadata (passed through results)
2. Fallback: Query BrKons API for the Gesetzesnummer to find the Materialien field

Then fetch parlament.gv.at detail page as JSON (?json=TRUE) to get:
- Title of the Regierungsvorlage
- Erläuterungen document links (HTML or PDF)
- Erläuterungen text content (from HTML version)
"""

import logging
import re

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "application/json, text/html, */*",
}


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


def parse_materialien_string(text: str) -> tuple[str, str]:
    """Parse a Materialienzeile to extract GP and RV number.

    Typical format from BrKons Gesetzesmaterialien field:
        "NR: GP XXVIII RV 301 AB 389 S. 52. BR: AB 12345 S. 67."
        "GP XXVII RV 2261 AB 2319"
        "NR: GP XXVIII IA 1234/A AB 567 S. 89."
    """
    if not text:
        return "", ""

    # Pattern: "GP XXVIII RV 301" or "GP XXVII IA 1234"
    m = re.search(r'GP\s+([IVXLC]+)\s+(?:RV|IA)\s+(\d+)', text)
    if m:
        return m.group(1), m.group(2)

    # Fallback: "GP XXVIII 301"
    m = re.search(r'GP\s+([IVXLC]+)\s+(\d+)', text)
    if m:
        return m.group(1), m.group(2)

    return "", ""


async def _find_materialien_from_brcons(gesetzesnummer: str) -> str:
    """Query BrKons API to find the Gesetzesmaterialien field for a law."""
    if not gesetzesnummer:
        return ""

    url = f"{settings.RIS_API_BASE_URL}/Bundesrecht"
    params = {
        "Applikation": "BrKons",
        "Gesetzesnummer": gesetzesnummer,
        "DokumenteProSeite": "Ten",
        "Seitennummer": "1",
    }

    async with httpx.AsyncClient(timeout=15.0) as client:
        try:
            resp = await client.get(url, params=params)
            resp.raise_for_status()
            data = resp.json()
        except Exception as e:
            logger.error(f"BrKons Materialien lookup error: {e}")
            return ""

    refs = data.get("OgdSearchResult", {}).get("OgdDocumentResults", {}).get("OgdDocumentReference", [])
    if isinstance(refs, dict):
        refs = [refs]

    for ref in refs:
        m = ref.get("Data", {}).get("Metadaten", {})
        # Search through all metadata sections for Gesetzesmaterialien
        for section_key in ("Bundesrecht", "BrKons", "Allgemein", "Technisch"):
            section = m.get(section_key)
            if isinstance(section, list) and section:
                section = section[0]
            if isinstance(section, dict):
                # Check the section itself and nested BrKons
                for check in [section, section.get("BrKons", {})]:
                    if isinstance(check, list) and check:
                        check = check[0]
                    if isinstance(check, dict):
                        mat = check.get("Gesetzesmaterialien", "") or check.get("Materialien", "")
                        if mat:
                            logger.info(f"Found Materialien for GN {gesetzesnummer}: {str(mat)[:100]}")
                            return str(mat)

    logger.info(f"No Materialien field found for Gesetzesnummer {gesetzesnummer}")
    return ""


async def _fetch_parlament_page(gp: str, rv_nr: str, bgbl_str: str) -> dict:
    """Fetch the parlament.gv.at JSON detail page for a Regierungsvorlage.

    URL format: https://www.parlament.gv.at/gegenstand/{GP}/I/{RV_NR}?json=TRUE
    The JSON response has:
    - title: page title
    - content.title: title of the RV
    - content.shortinfo: short description (since XXVI. GP)
    - content.phase[]: phases with documents
    - content.documents[]: direct document links
    """
    url = f"https://www.parlament.gv.at/gegenstand/{gp}/I/{rv_nr}"
    json_url = f"{url}?json=TRUE"

    logger.info(f"Fetching parlament.gv.at: {json_url}")

    result = {
        "bgbl": bgbl_str, "rv_nr": rv_nr, "gp": gp,
        "titel": "", "erlaeuterungen_url": "", "erlaeuterungen_text": "",
        "parlament_url": url,
    }

    async with httpx.AsyncClient(timeout=25.0, follow_redirects=True, headers=_HEADERS) as client:
        try:
            resp = await client.get(json_url)
            resp.raise_for_status()
            data = resp.json()
        except httpx.HTTPStatusError as e:
            logger.error(f"parlament.gv.at HTTP {e.response.status_code} for {json_url}")
            return result
        except Exception as e:
            logger.error(f"parlament.gv.at error for {json_url}: {e}")
            return result

        content = data.get("content", {})
        if not content:
            logger.warning(f"No content in parlament.gv.at response for {json_url}")
            # Log keys to debug
            logger.info(f"Response keys: {list(data.keys())[:10]}")
            return result

        # Extract title
        result["titel"] = (
            content.get("title", "")
            or content.get("shortTitle", "")
            or data.get("title", "")
        )

        # Short info / description
        shortinfo = content.get("shortinfo", "")
        if isinstance(shortinfo, dict):
            shortinfo = shortinfo.get("text", "")
        elif isinstance(shortinfo, list) and shortinfo:
            shortinfo = str(shortinfo[0])
        result["shortinfo"] = str(shortinfo)[:1000] if shortinfo else ""

        # Search for Erläuterungen documents in multiple locations
        erl_url = ""
        erl_html_url = ""

        # 1. Search content/documents (direct document list)
        _search_docs(content.get("documents", []), erl_url, erl_html_url)

        # 2. Search content/phase (phase-specific documents)
        phases = content.get("phase", [])
        if isinstance(phases, list):
            for phase in phases:
                if isinstance(phase, dict):
                    phase_docs = phase.get("documents", [])
                    erl_url, erl_html_url = _search_for_erlaeuterungen(phase_docs, erl_url, erl_html_url)
                    # Also check nested phases
                    for sub in phase.get("phase", []) if isinstance(phase.get("phase"), list) else []:
                        if isinstance(sub, dict):
                            erl_url, erl_html_url = _search_for_erlaeuterungen(
                                sub.get("documents", []), erl_url, erl_html_url
                            )

        # 3. If still nothing, search all documents regardless of title
        if not erl_url:
            all_docs = content.get("documents", [])
            if isinstance(all_docs, list):
                for doc_group in all_docs:
                    if isinstance(doc_group, dict):
                        docs = doc_group.get("documents", [])
                        if isinstance(docs, list):
                            for doc in docs:
                                link = doc.get("link", "")
                                if link and ("erla" in link.lower() or "erl" in doc.get("title", "").lower()):
                                    erl_url = _abs_url(link)
                                    if link.endswith(".html"):
                                        erl_html_url = erl_url

        result["erlaeuterungen_url"] = erl_url or erl_html_url

        # Fetch Erläuterungen text if HTML version available
        fetch_url = erl_html_url or erl_url
        if fetch_url and (".html" in fetch_url.lower()):
            try:
                import html as html_mod
                resp2 = await client.get(fetch_url)
                resp2.raise_for_status()
                raw = resp2.text
                # Strip HTML to text
                clean = re.sub(r'<(script|style)[^>]*>.*?</\1>', '', raw, flags=re.DOTALL | re.IGNORECASE)
                clean = re.sub(r'<[^>]+>', ' ', clean)
                clean = html_mod.unescape(clean)
                clean = re.sub(r'\s+', ' ', clean).strip()
                if len(clean) > 100:
                    result["erlaeuterungen_text"] = clean[:3000]
                    logger.info(f"Fetched Erläuterungen text: {len(result['erlaeuterungen_text'])} chars from {fetch_url}")
            except Exception as e:
                logger.warning(f"Could not fetch Erläuterungen HTML: {e}")

        # If no Erläuterungen text yet, use shortinfo as fallback context
        if not result.get("erlaeuterungen_text") and result.get("shortinfo"):
            result["erlaeuterungen_text"] = f"Kurzbeschreibung: {result['shortinfo']}"

        logger.info(f"Parlament result: titel={result['titel'][:60]}, erl_url={bool(result['erlaeuterungen_url'])}, erl_text={len(result.get('erlaeuterungen_text',''))} chars")

    return result


def _abs_url(link: str) -> str:
    """Convert relative parlament.gv.at link to absolute URL."""
    if not link:
        return ""
    if link.startswith("http"):
        return link
    return f"https://www.parlament.gv.at{link}"


def _search_for_erlaeuterungen(documents: list | dict, erl_url: str, erl_html_url: str) -> tuple[str, str]:
    """Search a documents list/group for Erläuterungen links."""
    if isinstance(documents, dict):
        documents = [documents]
    if not isinstance(documents, list):
        return erl_url, erl_html_url

    for doc_group in documents:
        if isinstance(doc_group, dict):
            group_title = str(doc_group.get("title", "")).lower()
            # Match: "Erläuterungen", "Erläuternde Bemerkungen", etc.
            is_erl = any(kw in group_title for kw in ("erläut", "erlaut", "erklär", "begründ", "materialien"))

            docs = doc_group.get("documents", [])
            if isinstance(docs, dict):
                docs = [docs]
            if not isinstance(docs, list):
                continue

            for doc in docs:
                if not isinstance(doc, dict):
                    continue
                link = doc.get("link", "")
                doc_title = str(doc.get("title", "")).lower()

                if is_erl or "erläut" in doc_title or "erlaut" in doc_title:
                    full_url = _abs_url(link)
                    if link.endswith(".html") or "html" in link.lower():
                        erl_html_url = erl_html_url or full_url
                    if not erl_url:
                        erl_url = full_url

    return erl_url, erl_html_url


def _search_docs(documents, erl_url, erl_html_url):
    """Convenience wrapper for initial document search."""
    return _search_for_erlaeuterungen(documents, erl_url, erl_html_url)


async def fetch_materialien_for_bgbl(bgbl_str: str, gesetzesnummer: str = "", materialien_str: str = "") -> dict | None:
    """Fetch parliamentary materials (Erläuterungen) for a BGBl number.

    Args:
        bgbl_str: Full BGBl string, e.g. "BGBl. I Nr. 6/2026"
        gesetzesnummer: Optional Gesetzesnummer for BrKons lookup
        materialien_str: Optional pre-extracted Materialien field from BrKons metadata
    """
    if not bgbl_str:
        return None

    bgbl_match = re.search(r'Nr\.?\s*(\d+)/(\d{4})', bgbl_str)
    if not bgbl_match:
        logger.warning(f"Could not parse BGBl number from: {bgbl_str}")
        return None
    bgbl_nr = bgbl_match.group(1)
    bgbl_year = bgbl_match.group(2)
    logger.info(f"Materialien lookup: BGBl Nr. {bgbl_nr}/{bgbl_year}, GN={gesetzesnummer}, mat_str={materialien_str[:80] if materialien_str else 'none'}")

    # Step 1: Parse GP + RV from Materialien string (fastest path)
    gp, rv_nr = parse_materialien_string(materialien_str)

    # Step 2: If no Materialien string provided, query BrKons for it
    if not rv_nr and gesetzesnummer:
        mat_str = await _find_materialien_from_brcons(gesetzesnummer)
        gp, rv_nr = parse_materialien_string(mat_str)

    # Step 3: No RV found — return search link
    if not rv_nr:
        gp = gp or _guess_gp(bgbl_year)
        logger.info(f"No RV found for BGBl {bgbl_str}, returning search link")
        return {
            "bgbl": bgbl_str, "rv_nr": "", "gp": gp,
            "titel": "", "erlaeuterungen_url": "", "erlaeuterungen_text": "",
            "parlament_url": f"https://www.parlament.gv.at/gegenstand?GP={gp}&NRBR=NR&VHG=REGV",
        }

    # Step 4: Fetch parlament.gv.at detail page
    return await _fetch_parlament_page(gp, rv_nr, bgbl_str)


async def fetch_materialien_for_results(results: list[dict]) -> dict[str, dict]:
    """Fetch Materialien for all unique BGBl numbers in search results.

    Groups results by BGBl, fetches Materialien for each unique BGBl.
    Also collects gesetzesnummer and materialien strings from results
    for more reliable lookup.
    """
    import asyncio

    # Extract unique BGBl numbers + associated metadata
    bgbl_map: dict[str, dict] = {}
    for r in results:
        bgbl = r.get("bgbl", "")
        if bgbl and "BGBl" in bgbl:
            m = re.search(r'Nr\.?\s*\d+/\d{4}', bgbl)
            if m:
                key = m.group(0)
                if key not in bgbl_map:
                    bgbl_map[key] = {
                        "bgbl": bgbl,
                        "gesetzesnummer": r.get("gesetzesnummer", ""),
                        "materialien": r.get("materialien", ""),
                    }

    if not bgbl_map:
        return {}

    logger.info(f"Fetching Materialien for {len(bgbl_map)} unique BGBl numbers")

    # Fetch all in parallel (max 10)
    tasks = [
        fetch_materialien_for_bgbl(
            bgbl_str=info["bgbl"],
            gesetzesnummer=info["gesetzesnummer"],
            materialien_str=info["materialien"],
        )
        for info in list(bgbl_map.values())[:20]
    ]
    results_mat = await asyncio.gather(*tasks, return_exceptions=True)

    materialien = {}
    for key, result in zip(bgbl_map.keys(), results_mat):
        if isinstance(result, dict):
            materialien[key] = result
        elif isinstance(result, Exception):
            logger.error(f"Materialien error for {key}: {result}")

    return materialien
