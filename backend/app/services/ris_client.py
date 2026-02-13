"""Client for the Austrian RIS (Rechtsinformationssystem) OGD API v2.6."""

import logging
from datetime import date, datetime, timezone

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

# Valid ImRisSeit enum values for Bundesrecht/Landesrecht date filtering.
# The API does NOT support arbitrary date ranges for these endpoints.
IM_RIS_SEIT_VALUES = [
    ("EinerWoche", 7),
    ("ZweiWochen", 14),
    ("EinemMonat", 31),
    ("DreiMonaten", 93),
    ("SechsMonaten", 186),
    ("EinemJahr", 366),
]


def _map_date_range_to_im_ris_seit(date_from: date | None) -> str | None:
    """Map a date_from to the closest ImRisSeit enum value.

    The Bundesrecht/Landesrecht API only supports predefined lookback periods,
    not arbitrary date ranges. Returns None if date_from is None.
    """
    if date_from is None:
        return None
    days_back = (date.today() - date_from).days
    if days_back <= 0:
        return "EinerWoche"
    for label, max_days in IM_RIS_SEIT_VALUES:
        if days_back <= max_days:
            return label
    # More than a year — use the maximum
    return "EinemJahr"

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

# Court sources available in the RIS Judikatur API
COURT_SOURCES = {
    "justiz": {"label": "Ordentliche Gerichte (OGH, OLG, …)", "path": "Justiz", "metadata_key": "Justiz"},
    "vfgh": {"label": "Verfassungsgerichtshof (VfGH)", "path": "Vfgh", "metadata_key": "Vfgh"},
    "vwgh": {"label": "Verwaltungsgerichtshof (VwGH)", "path": "Vwgh", "metadata_key": "Vwgh"},
    "bvwg": {"label": "Bundesverwaltungsgericht (BVwG)", "path": "Bvwg", "metadata_key": "Bvwg"},
    "lvwg": {"label": "Landesverwaltungsgerichte (LVwG)", "path": "Lvwg", "metadata_key": "Lvwg"},
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
    """
    Fetch law changes from the RIS Bundesrecht or Landesrecht API.

    IMPORTANT: The Bundesrecht/Landesrecht API does NOT support arbitrary date ranges.
    The only date-related parameter is `ImRisSeit` with predefined enum values:
    EinerWoche, ZweiWochen, EinemMonat, DreiMonaten, SechsMonaten, EinemJahr.

    For Judikatur, use fetch_court_rulings() which supports EntscheidungsdatumVon/Bis.
    """
    params = {
        "Pagesize": min(page_size, 100),
        "Pagenumber": page,
    }

    if keywords:
        params["Suchworte"] = keywords
    if index_number:
        params["Index"] = index_number

    # Use ImRisSeit for date filtering (the only valid date param for Bundesrecht/Landesrecht)
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
            hits = data.get("OgdSearchResult", {}).get("Hits", {}).get("#text", "0")
            logger.info(f"RIS {endpoint} page {page}: {hits} hits total")
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
    """
    Fetch court rulings from a RIS Judikatur API endpoint.

    Uses the REST endpoint:
    GET /Judikatur/{Source}?Suchworte=...&EntscheidungsdatumVon=...&EntscheidungsdatumBis=...
    """
    source = COURT_SOURCES.get(court_source)
    if not source:
        logger.error(f"Unknown court source: {court_source}")
        return _empty_response()

    params = {
        "Pagesize": min(page_size, 100),
        "Pagenumber": page,
    }

    if keywords:
        params["Suchworte"] = keywords
    if date_from:
        params["EntscheidungsdatumVon"] = date_from.strftime("%Y-%m-%d")
    if date_to:
        params["EntscheidungsdatumBis"] = date_to.strftime("%Y-%m-%d")

    url = f"{settings.RIS_API_BASE_URL}/Judikatur/{source['path']}"

    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            response = await client.get(url, params=params)
            response.raise_for_status()
            return response.json()
        except httpx.HTTPStatusError as e:
            logger.error(f"RIS Judikatur API HTTP error ({court_source}): {e.response.status_code} – {e.response.text}")
            return _empty_response()
        except httpx.RequestError as e:
            logger.error(f"RIS Judikatur API request error ({court_source}): {e}")
            return _empty_response()


def _empty_response() -> dict:
    return {"OgdSearchResult": {"OgdDocumentResults": {"OgdDocumentReference": []}, "Hits": {"#text": "0"}}}


def parse_ris_response(data: dict, law_source: str = "bundesrecht") -> list[dict]:
    """Parse the RIS API response into a list of structured law change dicts.

    Each document is parsed independently — one bad document won't block the rest.
    """
    results = []
    law_type = "Bundesrecht" if law_source == "bundesrecht" else "Landesrecht"
    skipped = 0

    try:
        search_result = data.get("OgdSearchResult", {})
        doc_results = search_result.get("OgdDocumentResults", {})
        references = doc_results.get("OgdDocumentReference", [])

        # Handle single result (dict instead of list)
        if isinstance(references, dict):
            references = [references]

        # Handle None
        if references is None:
            references = []

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
                # Log first 200 chars of the problematic reference for debugging
                ref_str = str(ref)[:200]
                logger.debug(f"Problematic document data: {ref_str}")

    except Exception as e:
        logger.error(f"Error parsing RIS {law_type} response structure: {e}")

    logger.info(f"Parsed {len(results)} {law_type} entries ({skipped} skipped)")
    return results


def _parse_single_law_document(ref: dict, law_type: str) -> dict | None:
    """Parse a single OgdDocumentReference into a structured dict. Returns None if invalid."""
    data_entry = ref.get("Data", {})
    metadata = data_entry.get("Metadaten", {})

    # Try multiple metadata keys — the actual key depends on the document type
    br_metadata = (
        metadata.get("Bundesrecht")
        or metadata.get("Landesrecht")
        or metadata.get("BrKons")
        or metadata.get("LrKons")
        or {}
    )

    # Extract document ID — try multiple locations
    doc_id = (
        data_entry.get("Dokumentnummer", "")
        or ref.get("Dokumentnummer", "")
    )

    if not doc_id:
        logger.debug(f"Skipping document without ID. Keys in ref: {list(ref.keys())}, Data keys: {list(data_entry.keys())}")
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
        or data_entry.get("Kurztitel", "")
        or title[:200]
    )

    # Extract index/category info
    index_list = br_metadata.get("Indexe", "")
    if isinstance(index_list, str):
        indices = [i.strip() for i in index_list.split(";") if i.strip()]
    elif isinstance(index_list, list):
        indices = index_list
    else:
        indices = []

    # Extract BGBl/LGBl number
    bgbl = br_metadata.get("Aenderung", "") or br_metadata.get("Kundmachung", "") or br_metadata.get("StF", "")
    if isinstance(bgbl, list):
        bgbl = "; ".join(str(b) for b in bgbl)
    if isinstance(bgbl, dict):
        bgbl = str(bgbl)

    # Extract dates - try multiple date field names
    change_date_str = (
        br_metadata.get("Kundmachungsdatum", "")
        or br_metadata.get("Aenderungsdatum", "")
        or br_metadata.get("Unterzeichnungsdatum", "")
        or data_entry.get("Kundmachungsdatum", "")
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
        "content_snippet": schlagworte if isinstance(schlagworte, str) else "",
        "court_name": None,
        "case_number": None,
    }


def parse_judikatur_response(data: dict, court_source: str = "justiz") -> list[dict]:
    """Parse a RIS Judikatur API response into a list of structured dicts.

    Each document is parsed independently — one bad document won't block the rest.
    """
    results = []
    source = COURT_SOURCES.get(court_source, {})
    metadata_key = source.get("metadata_key", "Justiz")
    skipped = 0

    try:
        search_result = data.get("OgdSearchResult", {})
        doc_results = search_result.get("OgdDocumentResults", {})
        references = doc_results.get("OgdDocumentReference", [])

        if isinstance(references, dict):
            references = [references]

        if references is None:
            references = []

        logger.info(f"Parsing {len(references)} Judikatur ({court_source}) documents")

        for i, ref in enumerate(references):
            try:
                parsed = _parse_single_judikatur_document(ref, source, metadata_key, court_source)
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


def _parse_single_judikatur_document(ref: dict, source: dict, metadata_key: str, court_source: str) -> dict | None:
    """Parse a single Judikatur OgdDocumentReference. Returns None if invalid."""
    data_entry = ref.get("Data", {})
    metadata = data_entry.get("Metadaten", {})
    jud_metadata = metadata.get(metadata_key, metadata.get("Judikatur", {}))

    doc_id = (
        data_entry.get("Dokumentnummer", "")
        or ref.get("Dokumentnummer", "")
    )

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

    normen = jud_metadata.get("Norm", "")
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

    index_list = jud_metadata.get("Indexe", "")
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
        {"slug": slug, "label": info["label"], "path": info["path"]}
        for slug, info in COURT_SOURCES.items()
    ]
