"""Client for the Austrian RIS (Rechtsinformationssystem) OGD API v2.6.

API documentation: https://data.bka.gv.at/ris/api/v2.6/
Bundesrecht: GET /Bundesrecht?Applikation=BrKons&DokumenteProSeite=OneHundred&Seitennummer=1
Landesrecht: GET /Landesrecht?Applikation=LrKons&DokumenteProSeite=OneHundred&Seitennummer=1
Judikatur:   GET /Judikatur?Applikation=Justiz&DokumenteProSeite=OneHundred&Seitennummer=1
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

# DokumenteProSeite enum mapping
_PAGE_SIZE_MAP = {10: "Ten", 20: "Twenty", 50: "Fifty", 100: "OneHundred"}


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

# Court sources — Applikation values for Judikatur endpoint
COURT_SOURCES = {
    "justiz": {"label": "Ordentliche Gerichte (OGH, OLG, …)", "applikation": "Justiz"},
    "vfgh": {"label": "Verfassungsgerichtshof (VfGH)", "applikation": "Vfgh"},
    "vwgh": {"label": "Verwaltungsgerichtshof (VwGH)", "applikation": "Vwgh"},
    "bvwg": {"label": "Bundesverwaltungsgericht (BVwG)", "applikation": "Bvwg"},
    "lvwg": {"label": "Landesverwaltungsgerichte (LVwG)", "applikation": "Lvwg"},
}


# ──────────────────────────────────────
# API Fetch Functions
# ──────────────────────────────────────

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

    Uses documented API parameters:
    - Applikation: BrKons (Bundesrecht) or LrKons (Landesrecht)
    - DokumenteProSeite: Ten/Twenty/Fifty/OneHundred
    - Seitennummer: page number (1-based)
    - ImRisSeit: date lookback filter
    """
    applikation = "BrKons" if law_source == "bundesrecht" else "LrKons"
    params = {
        "Applikation": applikation,
        "DokumenteProSeite": _page_size_enum(page_size),
        "Seitennummer": page,
    }

    if keywords:
        params["Suchworte"] = keywords
    if index_number:
        params["Index"] = index_number

    im_ris_seit = _map_date_range_to_im_ris_seit(date_from)
    if im_ris_seit:
        params["ImRisSeit"] = im_ris_seit

    endpoint = "Bundesrecht" if law_source == "bundesrecht" else "Landesrecht"
    url = f"{settings.RIS_API_BASE_URL}/{endpoint}"

    logger.info(f"RIS {endpoint} request: page={page}, params={params}")

    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            response = await client.get(url, params=params)
            response.raise_for_status()
            data = response.json()

            # Check for API error
            error = data.get("OgdSearchResult", {}).get("Error")
            if error:
                logger.error(f"RIS API error ({endpoint}): {error}")
                return _empty_response()

            hits = data.get("OgdSearchResult", {}).get("Hits", {})
            hit_count = hits.get("#text", "0") if isinstance(hits, dict) else str(hits)
            page_info = f"page {hits.get('@pageNumber', '?')}/{hits.get('@pageSize', '?')}" if isinstance(hits, dict) else ""
            logger.info(f"RIS {endpoint} page {page}: {hit_count} total hits {page_info}")
            return data
        except httpx.HTTPStatusError as e:
            logger.error(f"RIS API HTTP error ({endpoint}): {e.response.status_code} – {e.response.text[:500]}")
            return _empty_response()
        except httpx.RequestError as e:
            logger.error(f"RIS API request error ({endpoint}): {e}")
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

    Uses documented API parameters:
    - Applikation: Justiz/Vfgh/Vwgh/Bvwg/Lvwg
    - EntscheidungsdatumVon/Bis: decision date range (YYYY-MM-DD)
    """
    source = COURT_SOURCES.get(court_source)
    if not source:
        logger.error(f"Unknown court source: {court_source}")
        return _empty_response()

    params = {
        "Applikation": source["applikation"],
        "DokumenteProSeite": _page_size_enum(page_size),
        "Seitennummer": page,
    }

    if keywords:
        params["Suchworte"] = keywords
    if date_from:
        params["EntscheidungsdatumVon"] = date_from.strftime("%Y-%m-%d")
    if date_to:
        params["EntscheidungsdatumBis"] = date_to.strftime("%Y-%m-%d")

    url = f"{settings.RIS_API_BASE_URL}/Judikatur"

    logger.info(f"RIS Judikatur ({court_source}) request: page={page}, params={params}")

    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            response = await client.get(url, params=params)
            response.raise_for_status()
            data = response.json()

            error = data.get("OgdSearchResult", {}).get("Error")
            if error:
                logger.error(f"RIS Judikatur API error ({court_source}): {error}")
                return _empty_response()

            hits = data.get("OgdSearchResult", {}).get("Hits", {})
            hit_count = hits.get("#text", "0") if isinstance(hits, dict) else str(hits)
            logger.info(f"RIS Judikatur ({court_source}) page {page}: {hit_count} total hits")
            return data
        except httpx.HTTPStatusError as e:
            logger.error(f"RIS Judikatur HTTP error ({court_source}): {e.response.status_code} – {e.response.text[:500]}")
            return _empty_response()
        except httpx.RequestError as e:
            logger.error(f"RIS Judikatur request error ({court_source}): {e}")
            return _empty_response()


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

    The API nests metadata as: Metadaten.Bundesrecht.BrKons.{fields}
    or Metadaten.Landesrecht.LrKons.{fields}
    We need the innermost dict containing the actual fields.
    """
    # Path 1: Metadaten.Bundesrecht.BrKons
    bundesrecht = metadata.get("Bundesrecht", {})
    if isinstance(bundesrecht, dict):
        brkons = bundesrecht.get("BrKons")
        if isinstance(brkons, dict) and brkons:
            return brkons
        # Maybe the fields are directly in Bundesrecht (without BrKons nesting)
        if "Kurztitel" in bundesrecht or "Langtitel" in bundesrecht:
            return bundesrecht

    # Path 2: Metadaten.Landesrecht.LrKons
    landesrecht = metadata.get("Landesrecht", {})
    if isinstance(landesrecht, dict):
        lrkons = landesrecht.get("LrKons")
        if isinstance(lrkons, dict) and lrkons:
            return lrkons
        if "Kurztitel" in landesrecht or "Langtitel" in landesrecht:
            return landesrecht

    # Path 3: Direct keys (BrKons/LrKons at top level of Metadaten)
    for key in ("BrKons", "LrKons"):
        block = metadata.get(key)
        if isinstance(block, dict) and block:
            return block

    # Path 4: Fall back to Bundesrecht or Landesrecht dict itself
    if isinstance(bundesrecht, dict) and bundesrecht:
        return bundesrecht
    if isinstance(landesrecht, dict) and landesrecht:
        return landesrecht

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
        logger.debug(f"Skipping document without ID. Metadata keys: {list(metadata.keys())}")
        return None

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

    The API nests metadata as: Metadaten.Judikatur.{Applikation}.{fields}
    e.g. Metadaten.Judikatur.Justiz.Geschaeftszahl
    """
    judikatur = metadata.get("Judikatur", {})
    if isinstance(judikatur, dict):
        # Try the specific court metadata key
        inner = judikatur.get(applikation)
        if isinstance(inner, dict) and inner:
            return inner
        # Maybe fields are directly in Judikatur
        if "Geschaeftszahl" in judikatur or "Entscheidungsdatum" in judikatur:
            return judikatur

    # Try direct key at Metadaten level
    direct = metadata.get(applikation)
    if isinstance(direct, dict) and direct:
        return direct

    # Fallback
    if isinstance(judikatur, dict) and judikatur:
        return judikatur

    return {}


def _parse_single_judikatur_document(ref: dict, source: dict, applikation: str, court_source: str) -> dict | None:
    """Parse a single Judikatur OgdDocumentReference."""
    data_entry = ref.get("Data", {})
    metadata = data_entry.get("Metadaten", {})

    # Navigate the nested metadata correctly
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
