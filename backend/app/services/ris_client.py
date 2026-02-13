"""Client for the Austrian RIS (Rechtsinformationssystem) OGD API v2.6.

API documentation: https://data.bka.gv.at/ris/api/v2.6/
Bundesrecht: GET /Bundesrecht
Landesrecht: GET /Landesrecht
Judikatur:   GET /Judikatur
"""

import logging
from datetime import date, datetime, timezone

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

# Valid ImRisSeit enum values for date filtering.
IM_RIS_SEIT_VALUES = [
    ("EinerWoche", 7),
    ("ZweiWochen", 14),
    ("EinemMonat", 31),
    ("DreiMonaten", 93),
    ("SechsMonaten", 186),
    ("EinemJahr", 366),
]


def _map_date_range_to_im_ris_seit(date_from: date | None) -> str | None:
    """Map a date_from to the closest ImRisSeit enum value."""
    if date_from is None:
        return None
    days_back = (date.today() - date_from).days
    if days_back <= 0:
        return "EinerWoche"
    for label, max_days in IM_RIS_SEIT_VALUES:
        if days_back <= max_days:
            return label
    return "EinemJahr"


def _page_size_enum(size: int) -> str:
    """Convert numeric page size to the API's DokumenteProSeite enum value."""
    if size <= 10:
        return "Ten"
    if size <= 20:
        return "Twenty"
    if size <= 50:
        return "Fifty"
    return "OneHundred"


# Legal categories available in the RIS system
LEGAL_CATEGORIES = {
    "verfassungsrecht": {"label": "Verfassungsrecht", "index": "1"},
    "verwaltungsrecht_allgemein": {"label": "Verwaltungsrecht – Allgemeiner Teil", "index": "2"},
    "aeusseres": {"label": "Äußeres", "index": "3"},
    "finanzrecht": {"label": "Finanzrecht", "index": "4"},
    "gesundheit": {"label": "Gesundheit", "index": "5"},
    "justiz": {"label": "Justiz", "index": "6"},
    "landesverteidigung": {"label": "Landesverteidigung", "index": "7"},
    "land_forstwirtschaft": {"label": "Land- und Forstwirtschaft", "index": "8"},
    "soziales": {"label": "Soziales", "index": "9"},
    "unterricht_kunst_kultur": {"label": "Unterricht, Kunst und Kultur", "index": "10"},
    "verkehr": {"label": "Verkehr", "index": "11"},
    "wirtschaft": {"label": "Wirtschaft", "index": "12"},
    "wissenschaft_forschung": {"label": "Wissenschaft und Forschung", "index": "13"},
    "arbeit": {"label": "Arbeit", "index": "14"},
    "umwelt": {"label": "Umwelt", "index": "15"},
    "sport": {"label": "Sport", "index": "16"},
    "buergerrecht": {"label": "Bürgerrecht", "index": "17"},
    "medien": {"label": "Medien", "index": "18"},
    "bauten": {"label": "Bauten", "index": "19"},
    "mietrecht": {"label": "Mietrecht", "index": "20"},
    "strafrecht": {"label": "Strafrecht", "index": "21"},
    "zivilrecht": {"label": "Zivilrecht", "index": "22"},
    "datenschutz": {"label": "Datenschutz", "index": "23"},
    "eu_recht": {"label": "EU-Recht", "index": "24"},
}

# Court sources — keys used for Judikatur endpoint
COURT_SOURCES = {
    "justiz": {"label": "Ordentliche Gerichte (OGH, OLG, …)", "applikation": "Justiz"},
    "vfgh": {"label": "Verfassungsgerichtshof (VfGH)", "applikation": "Vfgh"},
    "vwgh": {"label": "Verwaltungsgerichtshof (VwGH)", "applikation": "Vwgh"},
    "bvwg": {"label": "Bundesverwaltungsgericht (BVwG)", "applikation": "Bvwg"},
    "lvwg": {"label": "Landesverwaltungsgerichte (LVwG)", "applikation": "Lvwg"},
}


# ──────────────────────────────────────
# Core HTTP helper
# ──────────────────────────────────────

async def _ris_get(url: str, params: dict, label: str) -> dict:
    """Make a GET request to the RIS API and return parsed JSON.

    Returns the parsed JSON if successful, or the empty response sentinel on error.
    Logs detailed information about the request and response.
    """
    logger.info(f"RIS {label}: GET {url} params={params}")
    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            response = await client.get(url, params=params)
            logger.info(f"RIS {label}: HTTP {response.status_code}, URL={response.url}")
            response.raise_for_status()
            data = response.json()

            # Check for API error response
            error = data.get("OgdSearchResult", {}).get("Error")
            if error:
                logger.error(f"RIS {label}: API Error: {error}")
                return _empty_response()

            # Log hit info
            hits = data.get("OgdSearchResult", {}).get("Hits", {})
            if isinstance(hits, dict):
                hit_count = hits.get("#text", "0")
                logger.info(f"RIS {label}: {hit_count} total hits")
            else:
                logger.info(f"RIS {label}: Hits={hits}")

            return data
        except httpx.HTTPStatusError as e:
            logger.error(f"RIS {label}: HTTP {e.response.status_code} – {e.response.text[:500]}")
            return _empty_response()
        except httpx.RequestError as e:
            logger.error(f"RIS {label}: Request error: {e}")
            return _empty_response()


async def _ris_get_raw(url: str, params: dict, label: str) -> dict:
    """Make a GET request and return raw diagnostic info (for debug endpoint)."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            response = await client.get(url, params=params)
            body_text = response.text[:2000]
            try:
                body_json = response.json()
            except Exception:
                body_json = None

            return {
                "status_code": response.status_code,
                "final_url": str(response.url),
                "params_sent": params,
                "body_preview": body_text[:500],
                "body_json": body_json,
                "hits": body_json.get("OgdSearchResult", {}).get("Hits") if body_json else None,
                "error": body_json.get("OgdSearchResult", {}).get("Error") if body_json else None,
                "doc_count": _count_docs(body_json) if body_json else 0,
            }
        except Exception as e:
            return {
                "status_code": None,
                "final_url": None,
                "params_sent": params,
                "error": str(e),
                "doc_count": 0,
            }


def _count_docs(data: dict) -> int:
    """Count documents in a RIS API response."""
    refs = data.get("OgdSearchResult", {}).get("OgdDocumentResults", {}).get("OgdDocumentReference", [])
    if isinstance(refs, dict):
        return 1
    if isinstance(refs, list):
        return len(refs)
    return 0


# ──────────────────────────────────────
# API Fetch Functions (with fallback)
# ──────────────────────────────────────

# We try TWO parameter styles because the API docs describe DokumenteProSeite/Seitennummer,
# but undocumented Pagesize/Pagenumber may also work. We try documented first, then fallback.

def _br_params_v1(page: int, page_size: int, law_source: str) -> dict:
    """Documented parameter names: Applikation + DokumenteProSeite + Seitennummer."""
    applikation = "BrKons" if law_source == "bundesrecht" else "LrKons"
    return {
        "Applikation": applikation,
        "DokumenteProSeite": _page_size_enum(page_size),
        "Seitennummer": page,
    }


def _br_params_v2(page: int, page_size: int, law_source: str) -> dict:
    """Documented params but WITHOUT Applikation (endpoint path may be sufficient)."""
    return {
        "DokumenteProSeite": _page_size_enum(page_size),
        "Seitennummer": page,
    }


def _br_params_v3(page: int, page_size: int, law_source: str) -> dict:
    """Undocumented but previously working: Pagesize/Pagenumber."""
    return {
        "Pagesize": min(page_size, 100),
        "Pagenumber": page,
    }


async def fetch_law_changes(
    date_from: date | None = None,
    date_to: date | None = None,
    keywords: str = "",
    index_number: str = "",
    page: int = 1,
    page_size: int = 100,
    law_source: str = "bundesrecht",
) -> dict:
    """Fetch law changes from the RIS Bundesrecht or Landesrecht API.

    Tries multiple parameter styles until one returns results.
    """
    endpoint = "Bundesrecht" if law_source == "bundesrecht" else "Landesrecht"
    url = f"{settings.RIS_API_BASE_URL}/{endpoint}"

    # Common params
    common = {}
    if keywords:
        common["Suchworte"] = keywords
    if index_number:
        common["Index"] = index_number
    im_ris_seit = _map_date_range_to_im_ris_seit(date_from)
    if im_ris_seit:
        common["ImRisSeit"] = im_ris_seit

    # Try parameter styles in order: documented first, then fallbacks
    param_styles = [
        ("v1-full", _br_params_v1(page, page_size, law_source)),
        ("v2-no-app", _br_params_v2(page, page_size, law_source)),
        ("v3-old", _br_params_v3(page, page_size, law_source)),
    ]

    for style_name, base_params in param_styles:
        params = {**base_params, **common}
        label = f"{endpoint}/{style_name}"
        data = await _ris_get(url, params, label)

        if _count_docs(data) > 0:
            logger.info(f"RIS {label}: SUCCESS — {_count_docs(data)} documents returned")
            return data
        logger.warning(f"RIS {label}: 0 documents, trying next style...")

    logger.error(f"RIS {endpoint}: All parameter styles returned 0 results")
    return _empty_response()


async def fetch_court_rulings(
    court_source: str = "justiz",
    date_from: date | None = None,
    date_to: date | None = None,
    keywords: str = "",
    page: int = 1,
    page_size: int = 100,
) -> dict:
    """Fetch court rulings from the RIS Judikatur API.

    Tries multiple endpoint/parameter styles until one returns results.
    """
    source = COURT_SOURCES.get(court_source)
    if not source:
        logger.error(f"Unknown court source: {court_source}")
        return _empty_response()

    applikation = source["applikation"]

    common = {}
    if keywords:
        common["Suchworte"] = keywords
    if date_from:
        common["EntscheidungsdatumVon"] = date_from.strftime("%Y-%m-%d")
    if date_to:
        common["EntscheidungsdatumBis"] = date_to.strftime("%Y-%m-%d")

    # Style 1: Query param based: /Judikatur?Applikation=Justiz
    # Style 2: Path based: /Judikatur/Justiz (old style)
    # Style 3: Query param without Applikation + old pagination
    attempts = [
        (
            f"{settings.RIS_API_BASE_URL}/Judikatur",
            {"Applikation": applikation, "DokumenteProSeite": _page_size_enum(page_size), "Seitennummer": page},
            f"Judikatur-v1({court_source})",
        ),
        (
            f"{settings.RIS_API_BASE_URL}/Judikatur",
            {"Applikation": applikation, "Pagesize": min(page_size, 100), "Pagenumber": page},
            f"Judikatur-v2({court_source})",
        ),
        (
            f"{settings.RIS_API_BASE_URL}/Judikatur/{applikation}",
            {"DokumenteProSeite": _page_size_enum(page_size), "Seitennummer": page},
            f"Judikatur-v3({court_source})",
        ),
        (
            f"{settings.RIS_API_BASE_URL}/Judikatur/{applikation}",
            {"Pagesize": min(page_size, 100), "Pagenumber": page},
            f"Judikatur-v4({court_source})",
        ),
    ]

    for url, base_params, label in attempts:
        params = {**base_params, **common}
        data = await _ris_get(url, params, label)

        if _count_docs(data) > 0:
            logger.info(f"RIS {label}: SUCCESS — {_count_docs(data)} documents returned")
            return data
        logger.warning(f"RIS {label}: 0 documents, trying next style...")

    logger.error(f"RIS Judikatur ({court_source}): All parameter styles returned 0 results")
    return _empty_response()


async def debug_ris_api_raw(endpoint: str = "bundesrecht") -> dict:
    """Test multiple parameter combinations and return raw results for debugging.

    This is called by the debug-ris endpoint to diagnose which API params work.
    """
    base_url = settings.RIS_API_BASE_URL
    results = {}

    if endpoint in ("bundesrecht", "landesrecht"):
        url = f"{base_url}/{'Bundesrecht' if endpoint == 'bundesrecht' else 'Landesrecht'}"
        applikation = "BrKons" if endpoint == "bundesrecht" else "LrKons"

        # Test 1: Minimal — just ImRisSeit
        results["minimal"] = await _ris_get_raw(url, {"ImRisSeit": "EinemMonat"}, "minimal")

        # Test 2: With Applikation + documented pagination
        results["documented"] = await _ris_get_raw(url, {
            "Applikation": applikation,
            "DokumenteProSeite": "Twenty",
            "Seitennummer": 1,
            "ImRisSeit": "EinemMonat",
        }, "documented")

        # Test 3: Without Applikation + documented pagination
        results["no_applikation"] = await _ris_get_raw(url, {
            "DokumenteProSeite": "Twenty",
            "Seitennummer": 1,
            "ImRisSeit": "EinemMonat",
        }, "no_applikation")

        # Test 4: Old-style params (Pagesize/Pagenumber)
        results["old_style"] = await _ris_get_raw(url, {
            "Pagesize": 20,
            "Pagenumber": 1,
            "ImRisSeit": "EinemMonat",
        }, "old_style")

        # Test 5: No pagination at all, just ImRisSeit
        results["no_pagination"] = await _ris_get_raw(url, {
            "ImRisSeit": "EinerWoche",
        }, "no_pagination")

        # Test 6: Completely empty request
        results["empty"] = await _ris_get_raw(url, {}, "empty")

    else:
        source = COURT_SOURCES.get(endpoint, {})
        applikation = source.get("applikation", endpoint.capitalize())

        # Test query-param style
        results["query_param"] = await _ris_get_raw(
            f"{base_url}/Judikatur",
            {"Applikation": applikation, "DokumenteProSeite": "Twenty", "Seitennummer": 1},
            "query_param",
        )
        # Test path style
        results["path_style"] = await _ris_get_raw(
            f"{base_url}/Judikatur/{applikation}",
            {"Pagesize": 20, "Pagenumber": 1},
            "path_style",
        )

    return {
        "base_url": base_url,
        "endpoint": endpoint,
        "tests": results,
        "summary": {
            name: {"doc_count": t.get("doc_count", 0), "error": t.get("error"), "status": t.get("status_code")}
            for name, t in results.items()
        },
    }


def _empty_response() -> dict:
    return {"OgdSearchResult": {"OgdDocumentResults": {"OgdDocumentReference": []}, "Hits": {"#text": "0"}}}


# ──────────────────────────────────────
# Response Parsing
# ──────────────────────────────────────

def _extract_references(data: dict) -> list[dict]:
    """Extract the OgdDocumentReference list from an API response."""
    search_result = data.get("OgdSearchResult", {})
    doc_results = search_result.get("OgdDocumentResults", {})
    references = doc_results.get("OgdDocumentReference", [])
    if isinstance(references, dict):
        references = [references]
    if references is None:
        references = []
    return references


def parse_ris_response(data: dict, law_source: str = "bundesrecht") -> list[dict]:
    """Parse the RIS API response into a list of structured law change dicts."""
    results = []
    law_type = "Bundesrecht" if law_source == "bundesrecht" else "Landesrecht"
    skipped = 0

    try:
        references = _extract_references(data)
        logger.info(f"Parsing {len(references)} {law_type} documents")

        for i, ref in enumerate(references):
            try:
                parsed = _parse_single_law_document(ref, law_type)
                if parsed:
                    results.append(parsed)
                else:
                    skipped += 1
            except Exception as e:
                skipped += 1
                logger.warning(f"Error parsing {law_type} document #{i}: {e}")
                logger.debug(f"Problematic document data: {str(ref)[:300]}")

    except Exception as e:
        logger.error(f"Error parsing RIS {law_type} response structure: {e}")

    logger.info(f"Parsed {len(results)} {law_type} entries ({skipped} skipped)")
    return results


def _get_br_metadata(metadata: dict) -> dict:
    """Extract the innermost Bundesrecht/Landesrecht metadata block.

    The API may nest metadata as:
    - Metadaten.Bundesrecht.BrKons.{fields}  (documented v2.6 nesting)
    - Metadaten.Bundesrecht.{fields}          (direct fields)
    - Metadaten.BrKons.{fields}               (BrKons at top level)
    We try all paths and return the one containing actual metadata fields.
    """
    # Path 1: Metadaten.Bundesrecht.BrKons (documented nesting)
    bundesrecht = metadata.get("Bundesrecht", {})
    if isinstance(bundesrecht, dict):
        brkons = bundesrecht.get("BrKons")
        if isinstance(brkons, dict) and brkons:
            return brkons
        # Maybe fields are directly in Bundesrecht
        if "Kurztitel" in bundesrecht or "Langtitel" in bundesrecht or "Aenderungsdatum" in bundesrecht:
            return bundesrecht

    # Path 2: Metadaten.Landesrecht.LrKons
    landesrecht = metadata.get("Landesrecht", {})
    if isinstance(landesrecht, dict):
        lrkons = landesrecht.get("LrKons")
        if isinstance(lrkons, dict) and lrkons:
            return lrkons
        if "Kurztitel" in landesrecht or "Langtitel" in landesrecht or "Aenderungsdatum" in landesrecht:
            return landesrecht

    # Path 3: Direct keys at Metadaten level
    for key in ("BrKons", "LrKons"):
        block = metadata.get(key)
        if isinstance(block, dict) and block:
            return block

    # Path 4: Fall back to Bundesrecht or Landesrecht dict itself
    if isinstance(bundesrecht, dict) and bundesrecht:
        return bundesrecht
    if isinstance(landesrecht, dict) and landesrecht:
        return landesrecht

    # Path 5: Maybe metadata IS the fields directly
    if "Kurztitel" in metadata or "Langtitel" in metadata:
        return metadata

    return {}


def _parse_single_law_document(ref: dict, law_type: str) -> dict | None:
    """Parse a single OgdDocumentReference into a structured dict."""
    data_entry = ref.get("Data", {})
    metadata = data_entry.get("Metadaten", {})

    # Navigate the nested metadata structure correctly
    br_metadata = _get_br_metadata(metadata)

    # Extract document ID
    doc_id = data_entry.get("Dokumentnummer", "") or ref.get("Dokumentnummer", "")
    if not doc_id:
        logger.debug(f"Skipping document without ID. Keys: ref={list(ref.keys())}, data={list(data_entry.keys())}, meta={list(metadata.keys())}")
        return None

    # Log metadata extraction status for first few documents
    if br_metadata:
        logger.debug(f"Doc {doc_id}: metadata keys={list(br_metadata.keys())[:5]}")
    else:
        logger.debug(f"Doc {doc_id}: NO metadata found. Metadaten keys={list(metadata.keys())}")

    # Extract title
    title = (
        br_metadata.get("Langtitel", "")
        or br_metadata.get("Kurztitel", "")
        or data_entry.get("Kurztitel", "")
        or doc_id
    )

    short_title = (
        br_metadata.get("Kurztitel", "")
        or br_metadata.get("Abkuerzung", "")
        or data_entry.get("Kurztitel", "")
        or title[:200]
    )

    # Extract index/category info
    index_list = br_metadata.get("Indexe", "") or br_metadata.get("Indizes", "")
    if isinstance(index_list, str):
        indices = [i.strip() for i in index_list.split(";") if i.strip()]
    elif isinstance(index_list, list):
        indices = index_list
    else:
        indices = []

    # Extract BGBl/LGBl number
    bgbl = (
        br_metadata.get("Aenderung", "")
        or br_metadata.get("Kundmachungsorgan", "")
        or br_metadata.get("StF", "")
        or ""
    )
    if isinstance(bgbl, list):
        bgbl = "; ".join(str(b) for b in bgbl)
    if isinstance(bgbl, dict):
        bgbl = str(bgbl)

    # Extract dates
    change_date_str = (
        br_metadata.get("Aenderungsdatum", "")
        or br_metadata.get("Inkrafttretensdatum", "")
        or br_metadata.get("Unterzeichnungsdatum", "")
        or data_entry.get("Aenderungsdatum", "")
        or ""
    )
    pub_date_str = (
        br_metadata.get("Veroeffentlichungsdatum", "")
        or data_entry.get("Veroeffentlichungsdatum", "")
        or change_date_str
    )

    change_date = _parse_date(change_date_str)
    pub_date = _parse_date(pub_date_str)

    # Extract document URL
    doc_url = ref.get("DokumentUrl", "") or data_entry.get("DokumentUrl", "") or ""

    # Extract keywords/Schlagworte
    schlagworte = br_metadata.get("Schlagworte", "") or ""
    if isinstance(schlagworte, list):
        schlagworte = ", ".join(str(s) for s in schlagworte)
    categories = []
    if isinstance(schlagworte, str) and schlagworte:
        categories = [s.strip() for s in schlagworte.split(",") if s.strip()]

    # Document type info for display
    doc_typ = br_metadata.get("Typ", "")
    artikel = br_metadata.get("ArtikelParagraphAnlage", "")
    snippet_parts = []
    if doc_typ:
        snippet_parts.append(f"Typ: {doc_typ}")
    if artikel:
        snippet_parts.append(artikel)
    if schlagworte:
        snippet_parts.append(schlagworte)
    content_snippet = ". ".join(snippet_parts)

    return {
        "ris_doc_id": doc_id,
        "title": title,
        "short_title": short_title,
        "law_type": law_type,
        "bgbl_number": str(bgbl) if bgbl else "",
        "categories": categories,
        "index_numbers": indices,
        "change_date": change_date,
        "publication_date": pub_date,
        "document_url": doc_url,
        "content_snippet": content_snippet[:2000] if content_snippet else "",
        "court_name": None,
        "case_number": None,
    }


def parse_judikatur_response(data: dict, court_source: str = "justiz") -> list[dict]:
    """Parse a RIS Judikatur API response into structured dicts."""
    results = []
    source = COURT_SOURCES.get(court_source, {})
    applikation = source.get("applikation", "Justiz")
    skipped = 0

    try:
        references = _extract_references(data)
        logger.info(f"Parsing {len(references)} Judikatur ({court_source}) documents")

        for i, ref in enumerate(references):
            try:
                parsed = _parse_single_judikatur_document(ref, source, applikation, court_source)
                if parsed:
                    results.append(parsed)
                else:
                    skipped += 1
            except Exception as e:
                skipped += 1
                logger.warning(f"Error parsing Judikatur ({court_source}) document #{i}: {e}")

    except Exception as e:
        logger.error(f"Error parsing Judikatur response structure ({court_source}): {e}")

    logger.info(f"Parsed {len(results)} Judikatur ({court_source}) entries ({skipped} skipped)")
    return results


def _get_jud_metadata(metadata: dict, applikation: str) -> dict:
    """Extract the innermost Judikatur metadata block.

    Tries: Metadaten.Judikatur.{Applikation} → Metadaten.Judikatur → Metadaten.{Applikation}
    """
    judikatur = metadata.get("Judikatur", {})
    if isinstance(judikatur, dict):
        inner = judikatur.get(applikation)
        if isinstance(inner, dict) and inner:
            return inner
        if "Geschaeftszahl" in judikatur or "Entscheidungsdatum" in judikatur:
            return judikatur

    direct = metadata.get(applikation)
    if isinstance(direct, dict) and direct:
        return direct

    if isinstance(judikatur, dict) and judikatur:
        return judikatur

    if "Geschaeftszahl" in metadata or "Entscheidungsdatum" in metadata:
        return metadata

    return {}


def _parse_single_judikatur_document(ref: dict, source: dict, applikation: str, court_source: str) -> dict | None:
    """Parse a single Judikatur OgdDocumentReference."""
    data_entry = ref.get("Data", {})
    metadata = data_entry.get("Metadaten", {})

    jud_metadata = _get_jud_metadata(metadata, applikation)

    doc_id = data_entry.get("Dokumentnummer", "") or ref.get("Dokumentnummer", "")
    if not doc_id:
        return None

    case_number = (
        jud_metadata.get("Geschaeftszahl", "")
        or data_entry.get("Geschaeftszahl", "")
        or ""
    )

    court_name = (
        jud_metadata.get("Gericht", "")
        or data_entry.get("Gericht", "")
        or source.get("label", court_source)
    )

    title = (
        jud_metadata.get("Kurztitel", "")
        or data_entry.get("Kurztitel", "")
        or jud_metadata.get("Betreff", "")
        or f"{court_name} {case_number}"
    )

    short_title = (
        jud_metadata.get("Kurztitel", "")
        or data_entry.get("Kurztitel", "")
        or f"{court_name} {case_number}"
    )

    normen = jud_metadata.get("Norm", "") or ""
    if isinstance(normen, list):
        normen = "; ".join(str(n) for n in normen)
    if isinstance(normen, dict):
        normen = str(normen)

    decision_date_str = (
        jud_metadata.get("Entscheidungsdatum", "")
        or data_entry.get("Entscheidungsdatum", "")
        or ""
    )
    decision_date = _parse_date(decision_date_str)

    doc_url = ref.get("DokumentUrl", "") or data_entry.get("DokumentUrl", "") or ""

    schlagworte = jud_metadata.get("Schlagworte", "") or ""
    if isinstance(schlagworte, list):
        schlagworte = ", ".join(str(s) for s in schlagworte)
    categories = []
    if isinstance(schlagworte, str) and schlagworte:
        categories = [s.strip() for s in schlagworte.split(",") if s.strip()]

    rechtssatz = jud_metadata.get("Rechtssatz", "") or ""
    if isinstance(rechtssatz, list):
        rechtssatz = " ".join(str(r) for r in rechtssatz)

    content_snippet = rechtssatz or (schlagworte if isinstance(schlagworte, str) else "")
    if normen and content_snippet:
        content_snippet = f"Normen: {normen}. {content_snippet}"
    elif normen:
        content_snippet = f"Normen: {normen}"

    index_list = jud_metadata.get("Indexe", "") or ""
    if isinstance(index_list, str):
        indices = [i.strip() for i in index_list.split(";") if i.strip()]
    elif isinstance(index_list, list):
        indices = index_list
    else:
        indices = []

    return {
        "ris_doc_id": doc_id,
        "title": title,
        "short_title": short_title,
        "law_type": "Judikatur",
        "bgbl_number": case_number,
        "categories": categories,
        "index_numbers": indices,
        "change_date": decision_date,
        "publication_date": decision_date,
        "document_url": doc_url,
        "content_snippet": content_snippet[:2000] if content_snippet else "",
        "court_name": court_name,
        "case_number": case_number,
    }


# ──────────────────────────────────────
# Utilities
# ──────────────────────────────────────

def _parse_date(date_str) -> datetime | None:
    if not date_str:
        return None
    if isinstance(date_str, datetime):
        return date_str.replace(tzinfo=timezone.utc) if date_str.tzinfo is None else date_str
    if not isinstance(date_str, str):
        date_str = str(date_str)
    date_str = date_str.strip()
    if not date_str:
        return None
    for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M:%S.%f", "%Y-%m-%d", "%d.%m.%Y", "%d.%m.%Y %H:%M:%S"):
        try:
            return datetime.strptime(date_str, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    logger.debug(f"Could not parse date: '{date_str}'")
    return None


def get_legal_categories() -> list[dict]:
    """Return all available legal categories for user interest selection."""
    return [
        {"slug": slug, "label": info["label"], "index": info["index"]}
        for slug, info in LEGAL_CATEGORIES.items()
    ]


def get_court_sources() -> list[dict]:
    """Return all available court sources for scanning."""
    return [
        {"slug": slug, "label": info["label"], "applikation": info["applikation"]}
        for slug, info in COURT_SOURCES.items()
    ]
