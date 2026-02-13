"""Client for the Austrian RIS (Rechtsinformationssystem) OGD API v2.6."""

import logging
from datetime import date, datetime, timezone

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

# ImRisSeit enum values — filters by when documents were last changed in RIS.
IM_RIS_SEIT_VALUES = [
    ("EinerWoche", 7),
    ("ZweiWochen", 14),
    ("EinemMonat", 31),
    ("DreiMonaten", 93),
    ("SechsMonaten", 186),
    ("EinemJahr", 366),
]

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

COURT_SOURCES = {
    "justiz": {"label": "Ordentliche Gerichte (OGH, OLG, …)", "applikation": "Justiz"},
    "vfgh": {"label": "Verfassungsgerichtshof (VfGH)", "applikation": "Vfgh"},
    "vwgh": {"label": "Verwaltungsgerichtshof (VwGH)", "applikation": "Vwgh"},
    "bvwg": {"label": "Bundesverwaltungsgericht (BVwG)", "applikation": "Bvwg"},
    "lvwg": {"label": "Landesverwaltungsgerichte (LVwG)", "applikation": "Lvwg"},
}


def _map_date_range_to_im_ris_seit(date_from: date | None) -> str | None:
    """Map a date_from to the best-fitting ImRisSeit enum value."""
    if date_from is None:
        return None
    days_back = (date.today() - date_from).days
    if days_back <= 0:
        return "EinerWoche"
    for label, max_days in IM_RIS_SEIT_VALUES:
        if days_back <= max_days:
            return label
    return "EinemJahr"


# ──────────────────────────────────────
# API Fetch
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
    """Fetch Bundesrecht or Landesrecht from the RIS API."""
    params: dict = {
        "Pagesize": min(page_size, 100),
        "Pagenumber": page,
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

    logger.info(f"RIS {endpoint}: GET {url} params={params}")

    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            response = await client.get(url, params=params)
            logger.info(f"RIS {endpoint}: HTTP {response.status_code}, url={response.url}")
            response.raise_for_status()
            data = response.json()

            # Log hits
            hits = data.get("OgdSearchResult", {}).get("Hits", {})
            hit_text = hits.get("#text", "0") if isinstance(hits, dict) else str(hits)
            logger.info(f"RIS {endpoint} page {page}: {hit_text} total hits")
            return data
        except httpx.HTTPStatusError as e:
            logger.error(f"RIS {endpoint} HTTP {e.response.status_code}: {e.response.text[:500]}")
            return _empty_response()
        except httpx.RequestError as e:
            logger.error(f"RIS {endpoint} request error: {e}")
            return _empty_response()


async def fetch_court_rulings(
    court_source: str = "justiz",
    date_from: date | None = None,
    date_to: date | None = None,
    keywords: str = "",
    page: int = 1,
    page_size: int = 100,
) -> dict:
    """Fetch court rulings from the RIS Judikatur API."""
    source = COURT_SOURCES.get(court_source)
    if not source:
        logger.error(f"Unknown court source: {court_source}")
        return _empty_response()

    params: dict = {
        "Pagesize": min(page_size, 100),
        "Pagenumber": page,
    }
    if keywords:
        params["Suchworte"] = keywords
    if date_from:
        params["EntscheidungsdatumVon"] = date_from.strftime("%Y-%m-%d")
    if date_to:
        params["EntscheidungsdatumBis"] = date_to.strftime("%Y-%m-%d")

    url = f"{settings.RIS_API_BASE_URL}/Judikatur/{source['applikation']}"

    logger.info(f"RIS Judikatur ({court_source}): GET {url} params={params}")

    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            response = await client.get(url, params=params)
            logger.info(f"RIS Judikatur ({court_source}): HTTP {response.status_code}")
            response.raise_for_status()
            return response.json()
        except httpx.HTTPStatusError as e:
            logger.error(f"RIS Judikatur ({court_source}) HTTP {e.response.status_code}: {e.response.text[:500]}")
            return _empty_response()
        except httpx.RequestError as e:
            logger.error(f"RIS Judikatur ({court_source}) request error: {e}")
            return _empty_response()


def _empty_response() -> dict:
    return {"OgdSearchResult": {"OgdDocumentResults": {"OgdDocumentReference": []}, "Hits": {"#text": "0"}}}


# ──────────────────────────────────────
# Response Parsing
# ──────────────────────────────────────

def _extract_references(data: dict) -> list[dict]:
    """Extract OgdDocumentReference list from API response."""
    refs = data.get("OgdSearchResult", {}).get("OgdDocumentResults", {}).get("OgdDocumentReference", [])
    if isinstance(refs, dict):
        refs = [refs]
    return refs or []


def parse_ris_response(data: dict, law_source: str = "bundesrecht") -> list[dict]:
    """Parse RIS Bundesrecht/Landesrecht response into structured dicts."""
    law_type = "Bundesrecht" if law_source == "bundesrecht" else "Landesrecht"
    results = []
    skipped = 0

    try:
        references = _extract_references(data)
        logger.info(f"Parsing {len(references)} {law_type} documents")

        if references:
            # Log structure of first doc for debugging
            first = references[0]
            meta_keys = list(first.get("Data", {}).get("Metadaten", {}).keys())
            logger.info(f"First doc Metadaten keys: {meta_keys}")

        for i, ref in enumerate(references):
            try:
                parsed = _parse_single_law_document(ref, law_type)
                if parsed:
                    results.append(parsed)
                else:
                    skipped += 1
            except Exception as e:
                skipped += 1
                logger.warning(f"Error parsing {law_type} doc #{i}: {e}")

    except Exception as e:
        logger.error(f"Error parsing RIS {law_type} response: {e}")

    logger.info(f"Parsed {len(results)} {law_type} entries ({skipped} skipped)")
    return results


def _dig_metadata(metadata: dict) -> dict:
    """Find the innermost metadata dict with actual fields.

    The RIS API nests metadata differently depending on the document type:
      - Metadaten.Bundesrecht.BrKons.{Kurztitel, ...}
      - Metadaten.Bundesrecht.{Kurztitel, ...}
      - Metadaten.Landesrecht.LrKons.{Kurztitel, ...}
      - Metadaten.{Kurztitel, ...}

    We walk down the tree until we find a dict containing known field names.
    """
    known_fields = {"Kurztitel", "Langtitel", "Aenderungsdatum", "Inkrafttretensdatum", "Typ", "Schlagworte"}

    # Check if metadata itself has the fields
    if known_fields & set(metadata.keys()):
        return metadata

    # Walk one level: Bundesrecht, Landesrecht, BrKons, LrKons
    for key in ("Bundesrecht", "Landesrecht", "BrKons", "LrKons"):
        child = metadata.get(key)
        if not isinstance(child, dict):
            continue
        if known_fields & set(child.keys()):
            return child
        # Walk two levels: Bundesrecht.BrKons, Landesrecht.LrKons
        for subkey in ("BrKons", "LrKons"):
            grandchild = child.get(subkey)
            if isinstance(grandchild, dict) and (known_fields & set(grandchild.keys())):
                return grandchild

    # Fallback: return first non-empty child dict
    for key in ("Bundesrecht", "Landesrecht", "BrKons", "LrKons"):
        child = metadata.get(key)
        if isinstance(child, dict) and child:
            # Check its children too
            for v in child.values():
                if isinstance(v, dict) and (known_fields & set(v.keys())):
                    return v
            return child

    return {}


def _parse_single_law_document(ref: dict, law_type: str) -> dict | None:
    """Parse a single OgdDocumentReference."""
    data_entry = ref.get("Data", {})
    metadata = data_entry.get("Metadaten", {})
    m = _dig_metadata(metadata)

    doc_id = data_entry.get("Dokumentnummer", "") or ref.get("Dokumentnummer", "")
    if not doc_id:
        return None

    title = (
        m.get("Langtitel", "")
        or m.get("Kurztitel", "")
        or data_entry.get("Kurztitel", "")
        or doc_id
    )
    short_title = (
        m.get("Kurztitel", "")
        or m.get("Abkuerzung", "")
        or data_entry.get("Kurztitel", "")
        or title[:200]
    )

    # Indices
    index_list = m.get("Indexe", "") or m.get("Indizes", "")
    if isinstance(index_list, str):
        indices = [i.strip() for i in index_list.split(";") if i.strip()]
    elif isinstance(index_list, list):
        indices = index_list
    else:
        indices = []

    # BGBl number
    bgbl = m.get("Aenderung", "") or m.get("Kundmachungsorgan", "") or m.get("StF", "") or ""
    if isinstance(bgbl, list):
        bgbl = "; ".join(str(b) for b in bgbl)
    if isinstance(bgbl, dict):
        bgbl = str(bgbl)

    # Dates
    change_date_str = (
        m.get("Aenderungsdatum", "") or m.get("Inkrafttretensdatum", "")
        or m.get("Unterzeichnungsdatum", "") or data_entry.get("Aenderungsdatum", "") or ""
    )
    pub_date_str = m.get("Veroeffentlichungsdatum", "") or data_entry.get("Veroeffentlichungsdatum", "") or change_date_str

    # URL
    doc_url = ref.get("DokumentUrl", "") or data_entry.get("DokumentUrl", "") or ""

    # Keywords
    schlagworte = m.get("Schlagworte", "") or ""
    if isinstance(schlagworte, list):
        schlagworte = ", ".join(str(s) for s in schlagworte)
    categories = [s.strip() for s in schlagworte.split(",") if s.strip()] if isinstance(schlagworte, str) and schlagworte else []

    # Snippet
    doc_typ = m.get("Typ", "")
    artikel = m.get("ArtikelParagraphAnlage", "")
    parts = []
    if doc_typ:
        parts.append(f"Typ: {doc_typ}")
    if artikel:
        parts.append(artikel)
    if schlagworte:
        parts.append(schlagworte)
    content_snippet = ". ".join(parts)

    return {
        "ris_doc_id": doc_id,
        "title": title,
        "short_title": short_title,
        "law_type": law_type,
        "bgbl_number": str(bgbl) if bgbl else "",
        "categories": categories,
        "index_numbers": indices,
        "change_date": _parse_date(change_date_str),
        "publication_date": _parse_date(pub_date_str),
        "document_url": doc_url,
        "content_snippet": content_snippet[:2000] if content_snippet else "",
        "court_name": None,
        "case_number": None,
    }


def parse_judikatur_response(data: dict, court_source: str = "justiz") -> list[dict]:
    """Parse RIS Judikatur response."""
    source = COURT_SOURCES.get(court_source, {})
    applikation = source.get("applikation", "Justiz")
    results = []
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
                logger.warning(f"Error parsing Judikatur ({court_source}) doc #{i}: {e}")
    except Exception as e:
        logger.error(f"Error parsing Judikatur ({court_source}) response: {e}")

    logger.info(f"Parsed {len(results)} Judikatur ({court_source}) entries ({skipped} skipped)")
    return results


def _dig_jud_metadata(metadata: dict, applikation: str) -> dict:
    """Find innermost Judikatur metadata dict."""
    known = {"Geschaeftszahl", "Entscheidungsdatum", "Gericht", "Norm"}

    if known & set(metadata.keys()):
        return metadata

    jud = metadata.get("Judikatur", {})
    if isinstance(jud, dict):
        if known & set(jud.keys()):
            return jud
        inner = jud.get(applikation)
        if isinstance(inner, dict) and inner:
            return inner

    direct = metadata.get(applikation)
    if isinstance(direct, dict) and direct:
        return direct

    return jud if isinstance(jud, dict) else {}


def _parse_single_judikatur_document(ref: dict, source: dict, applikation: str, court_source: str) -> dict | None:
    """Parse a single Judikatur document."""
    data_entry = ref.get("Data", {})
    metadata = data_entry.get("Metadaten", {})
    m = _dig_jud_metadata(metadata, applikation)

    doc_id = data_entry.get("Dokumentnummer", "") or ref.get("Dokumentnummer", "")
    if not doc_id:
        return None

    case_number = m.get("Geschaeftszahl", "") or data_entry.get("Geschaeftszahl", "") or ""
    court_name = m.get("Gericht", "") or data_entry.get("Gericht", "") or source.get("label", court_source)
    title = m.get("Kurztitel", "") or data_entry.get("Kurztitel", "") or m.get("Betreff", "") or f"{court_name} {case_number}"
    short_title = m.get("Kurztitel", "") or data_entry.get("Kurztitel", "") or f"{court_name} {case_number}"

    normen = m.get("Norm", "") or ""
    if isinstance(normen, list):
        normen = "; ".join(str(n) for n in normen)
    if isinstance(normen, dict):
        normen = str(normen)

    decision_date_str = m.get("Entscheidungsdatum", "") or data_entry.get("Entscheidungsdatum", "") or ""
    decision_date = _parse_date(decision_date_str)

    doc_url = ref.get("DokumentUrl", "") or data_entry.get("DokumentUrl", "") or ""

    schlagworte = m.get("Schlagworte", "") or ""
    if isinstance(schlagworte, list):
        schlagworte = ", ".join(str(s) for s in schlagworte)
    categories = [s.strip() for s in schlagworte.split(",") if s.strip()] if isinstance(schlagworte, str) and schlagworte else []

    rechtssatz = m.get("Rechtssatz", "") or ""
    if isinstance(rechtssatz, list):
        rechtssatz = " ".join(str(r) for r in rechtssatz)

    content_snippet = rechtssatz or (schlagworte if isinstance(schlagworte, str) else "")
    if normen and content_snippet:
        content_snippet = f"Normen: {normen}. {content_snippet}"
    elif normen:
        content_snippet = f"Normen: {normen}"

    index_list = m.get("Indexe", "") or ""
    indices = [i.strip() for i in index_list.split(";") if i.strip()] if isinstance(index_list, str) else (index_list if isinstance(index_list, list) else [])

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
# Debug helper
# ──────────────────────────────────────

async def debug_ris_api_raw(endpoint: str = "bundesrecht") -> dict:
    """Call the RIS API with minimal params and return raw response for diagnosis."""
    if endpoint in ("bundesrecht", "landesrecht"):
        ep = "Bundesrecht" if endpoint == "bundesrecht" else "Landesrecht"
        url = f"{settings.RIS_API_BASE_URL}/{ep}"
        params = {"Pagesize": 5, "Pagenumber": 1, "ImRisSeit": "EinemMonat"}
    else:
        source = COURT_SOURCES.get(endpoint, {})
        app = source.get("applikation", "Justiz")
        url = f"{settings.RIS_API_BASE_URL}/Judikatur/{app}"
        params = {"Pagesize": 5, "Pagenumber": 1}

    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            resp = await client.get(url, params=params)
            data = resp.json() if resp.status_code == 200 else None
            refs = _extract_references(data) if data else []
            return {
                "url": str(resp.url),
                "status": resp.status_code,
                "doc_count": len(refs),
                "hits": data.get("OgdSearchResult", {}).get("Hits") if data else None,
                "error": data.get("OgdSearchResult", {}).get("Error") if data else resp.text[:500],
                "first_doc_keys": _doc_structure(refs[0]) if refs else None,
                "first_doc": refs[0] if refs else None,
            }
        except Exception as e:
            return {"url": url, "error": str(e)}


def _doc_structure(doc: dict) -> dict:
    """Show key structure of a document for debugging."""
    result = {"ref_keys": list(doc.keys())}
    data = doc.get("Data", {})
    result["data_keys"] = list(data.keys())
    meta = data.get("Metadaten", {})
    result["metadaten_keys"] = list(meta.keys())
    for k, v in meta.items():
        if isinstance(v, dict):
            result[f"metadaten.{k}_keys"] = list(v.keys())
            for k2, v2 in v.items():
                if isinstance(v2, dict):
                    result[f"metadaten.{k}.{k2}_keys"] = list(v2.keys())[:10]
    return result


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
    return [{"slug": slug, "label": info["label"], "index": info["index"]} for slug, info in LEGAL_CATEGORIES.items()]


def get_court_sources() -> list[dict]:
    return [{"slug": slug, "label": info["label"], "applikation": info["applikation"]} for slug, info in COURT_SOURCES.items()]
