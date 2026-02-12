"""Client for the Austrian RIS (Rechtsinformationssystem) OGD API v2.6."""

import logging
from datetime import date, datetime, timezone

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

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


async def fetch_law_changes(
    date_from: date | None = None,
    date_to: date | None = None,
    keywords: str = "",
    index_number: str = "",
    page: int = 1,
    page_size: int = 100,
) -> dict:
    """
    Fetch law changes from the RIS Bundesrecht API.

    Uses the REST endpoint:
    GET /Bundesrecht?Suchworte=...&AenderungsdatumVon=...&AenderungsdatumBis=...&Pagesize=...&Pagenumber=...
    """
    params = {
        "Pagesize": min(page_size, 100),
        "Pagenumber": page,
    }

    if keywords:
        params["Suchworte"] = keywords
    if date_from:
        params["AenderungsdatumVon"] = date_from.strftime("%Y-%m-%d")
    if date_to:
        params["AenderungsdatumBis"] = date_to.strftime("%Y-%m-%d")
    if index_number:
        params["Index"] = index_number

    url = f"{settings.RIS_API_BASE_URL}/Bundesrecht"

    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            response = await client.get(url, params=params)
            response.raise_for_status()
            return response.json()
        except httpx.HTTPStatusError as e:
            logger.error(f"RIS API HTTP error: {e.response.status_code} – {e.response.text}")
            return {"OgdSearchResult": {"OgdDocumentResults": {"OgdDocumentReference": []}, "Hits": {"#text": "0"}}}
        except httpx.RequestError as e:
            logger.error(f"RIS API request error: {e}")
            return {"OgdSearchResult": {"OgdDocumentResults": {"OgdDocumentReference": []}, "Hits": {"#text": "0"}}}


def parse_ris_response(data: dict) -> list[dict]:
    """Parse the RIS API response into a list of structured law change dicts."""
    results = []
    try:
        search_result = data.get("OgdSearchResult", {})
        doc_results = search_result.get("OgdDocumentResults", {})
        references = doc_results.get("OgdDocumentReference", [])

        # Handle single result (dict instead of list)
        if isinstance(references, dict):
            references = [references]

        for ref in references:
            data_entry = ref.get("Data", {})
            metadata = data_entry.get("Metadaten", {})
            br_metadata = metadata.get("Bundesrecht", metadata.get("BrKons", {}))
            doc_metadata = metadata.get("Dokumentliste", metadata)

            # Extract document ID
            doc_id = (
                data_entry.get("Dokumentnummer", "")
                or ref.get("Dokumentnummer", "")
            )

            # Extract title
            title = (
                br_metadata.get("Langtitel", "")
                or br_metadata.get("Kurztitel", "")
                or data_entry.get("Kurztitel", "")
                or ""
            )

            short_title = (
                br_metadata.get("Kurztitel", "")
                or data_entry.get("Kurztitel", "")
                or ""
            )

            # Extract index/category info
            index_list = br_metadata.get("Indexe", "")
            if isinstance(index_list, str):
                indices = [i.strip() for i in index_list.split(";") if i.strip()]
            elif isinstance(index_list, list):
                indices = index_list
            else:
                indices = []

            # Extract BGBl number
            bgbl = br_metadata.get("Aenderung", "")
            if isinstance(bgbl, list):
                bgbl = "; ".join(str(b) for b in bgbl)

            # Extract dates
            change_date_str = (
                br_metadata.get("Aenderungsdatum", "")
                or data_entry.get("Aenderungsdatum", "")
            )
            pub_date_str = (
                br_metadata.get("Veroeffentlichungsdatum", "")
                or data_entry.get("Veroeffentlichungsdatum", "")
            )

            change_date = _parse_date(change_date_str)
            pub_date = _parse_date(pub_date_str)

            # Extract document URL
            doc_url = ref.get("DokumentUrl", "") or data_entry.get("DokumentUrl", "")

            # Extract keywords/Schlagworte
            schlagworte = br_metadata.get("Schlagworte", "")
            categories = []
            if isinstance(schlagworte, str) and schlagworte:
                categories = [s.strip() for s in schlagworte.split(",") if s.strip()]

            results.append({
                "ris_doc_id": doc_id,
                "title": title,
                "short_title": short_title,
                "law_type": "Bundesrecht",
                "bgbl_number": str(bgbl),
                "categories": categories,
                "index_numbers": indices,
                "change_date": change_date,
                "publication_date": pub_date,
                "document_url": doc_url,
                "content_snippet": schlagworte if isinstance(schlagworte, str) else "",
            })
    except Exception as e:
        logger.error(f"Error parsing RIS response: {e}")

    return results


def _parse_date(date_str: str) -> datetime | None:
    if not date_str:
        return None
    for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%d", "%d.%m.%Y"):
        try:
            return datetime.strptime(date_str, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


def get_legal_categories() -> list[dict]:
    """Return all available legal categories for user interest selection."""
    return [
        {"slug": slug, "label": info["label"], "index": info["index"]}
        for slug, info in LEGAL_CATEGORIES.items()
    ]
