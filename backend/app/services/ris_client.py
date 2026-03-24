"""Client for the Austrian RIS (Rechtsinformationssystem) OGD API v2.6.

Supports two document types:
  - Gesetze und Verordnungen (Bundesrecht consolidated)
  - Gerichtsentscheidungen (Judikatur from all court sources)
"""

import asyncio
import logging
from datetime import date, timedelta

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

# ── Rechtsgebiete ──
# Note: The BrKons application does NOT support the Index parameter (always
# returns 0 hits). We use Suchworte (keyword search) for both Bundesrecht
# and Judikatur filtering.

LEGAL_CATEGORIES = [
    {"id": "verfassungsrecht", "label": "Verfassungsrecht"},
    {"id": "privatrecht", "label": "Privatrecht / Zivilrecht"},
    {"id": "strafrecht", "label": "Strafrecht"},
    {"id": "verwaltungsrecht", "label": "Verwaltungsrecht"},
    {"id": "finanzrecht", "label": "Finanzrecht / Steuerrecht"},
    {"id": "arbeitsrecht", "label": "Arbeitsrecht / Sozialrecht"},
    {"id": "wirtschaftsrecht", "label": "Wirtschaftsrecht / Gewerberecht"},
    {"id": "mietrecht", "label": "Mietrecht / Wohnrecht"},
    {"id": "umweltrecht", "label": "Umweltrecht"},
    {"id": "verkehrsrecht", "label": "Verkehrsrecht"},
    {"id": "gesundheitsrecht", "label": "Gesundheitsrecht"},
    {"id": "medienrecht", "label": "Medienrecht"},
    {"id": "datenschutz", "label": "Datenschutzrecht"},
    {"id": "bildungsrecht", "label": "Bildung / Wissenschaft / Kultur"},
    {"id": "familienrecht", "label": "Familienrecht / Personenrecht"},
    {"id": "europarecht", "label": "EU-Recht / Völkerrecht"},
]

# Suchworte (keyword search terms) for filtering by Rechtsgebiet.
_CATEGORY_KEYWORDS: dict[str, str] = {
    "verfassungsrecht": "Verfassung",
    "privatrecht": "ABGB",
    "strafrecht": "Strafrecht",
    "verwaltungsrecht": "Verwaltung",
    "finanzrecht": "Steuer",
    "arbeitsrecht": "Arbeit",
    "wirtschaftsrecht": "Gewerbe",
    "mietrecht": "Miet",
    "umweltrecht": "Umwelt",
    "verkehrsrecht": "Verkehr",
    "gesundheitsrecht": "Gesundheit",
    "medienrecht": "Medien",
    "datenschutz": "Datenschutz",
    "bildungsrecht": "Unterricht",
    "familienrecht": "Familie",
    "europarecht": "Europa",
}

# ── Timeframe options (ImRisSeit enum) ──

TIMEFRAMES = [
    {"value": "EinerWoche", "label": "Letzte Woche", "days": 7},
    {"value": "ZweiWochen", "label": "Letzte 2 Wochen", "days": 14},
    {"value": "EinemMonat", "label": "Letzter Monat", "days": 31},
    {"value": "DreiMonaten", "label": "Letzte 3 Monate", "days": 93},
    {"value": "SechsMonaten", "label": "Letzte 6 Monate", "days": 186},
    {"value": "EinemJahr", "label": "Letztes Jahr", "days": 366},
]

# ── Court sources for Judikatur ──

COURT_SOURCES = [
    {"applikation": "Justiz", "label": "Ordentliche Gerichte (OGH, OLG, …)"},
    {"applikation": "Vfgh", "label": "Verfassungsgerichtshof (VfGH)"},
    {"applikation": "Vwgh", "label": "Verwaltungsgerichtshof (VwGH)"},
    {"applikation": "Bvwg", "label": "Bundesverwaltungsgericht (BVwG)"},
    {"applikation": "Lvwg", "label": "Landesverwaltungsgerichte (LVwG)"},
]

# Map Rechtsgebiet → relevant court Applikation(en) for Judikatur.
# Unmapped categories → query all courts with Suchworte.
CATEGORY_TO_COURTS: dict[str, list[str]] = {
    "verfassungsrecht": ["Vfgh"],
    "verwaltungsrecht": ["Vwgh", "Bvwg", "Lvwg"],
    "privatrecht": ["Justiz"],
    "strafrecht": ["Justiz"],
    "mietrecht": ["Justiz"],
    "familienrecht": ["Justiz"],
    "datenschutz": ["Vwgh", "Bvwg"],
}

# DokumenteProSeite enum
DOCS_PER_PAGE = "Twenty"


# ── API Calls ──

async def search_gesetze(
    category: str,
    im_ris_seit: str,
    page: int = 1,
) -> dict:
    """Search Bundesrecht (Gesetze und Verordnungen).

    Uses: /Bundesrecht?Applikation=BrKons&Suchworte=...&ImRisSeit=...
    Note: Index parameter returns 0 hits for BrKons; Suchworte works.
    """
    params: dict = {
        "Applikation": "BrKons",
        "DokumenteProSeite": DOCS_PER_PAGE,
        "Seitennummer": page,
        "ImRisSeit": im_ris_seit,
    }
    if category:
        keywords = _CATEGORY_KEYWORDS.get(category, "")
        if keywords:
            params["Suchworte"] = keywords

    url = f"{settings.RIS_API_BASE_URL}/Bundesrecht"
    return await _fetch(url, params)


async def search_gerichtsentscheidungen(
    category: str,
    im_ris_seit: str,
    page: int = 1,
) -> dict:
    """Search Judikatur (Gerichtsentscheidungen).

    Uses: /Judikatur?Applikation=...&EntscheidungsdatumVon=...&Suchworte=...
    Strategy:
      - If the Rechtsgebiet maps to specific courts → query only those courts
      - Always use Suchworte with category keywords for topic filtering
      - If no Rechtsgebiet selected → query all courts unfiltered
    All court queries run in parallel.
    """
    days = _timeframe_to_days(im_ris_seit)
    date_from = (date.today() - timedelta(days=days)).strftime("%Y-%m-%d")

    has_court_mapping = category in CATEGORY_TO_COURTS
    courts = CATEGORY_TO_COURTS.get(category, [c["applikation"] for c in COURT_SOURCES])

    # Always use keywords for topic filtering
    suchworte = _CATEGORY_KEYWORDS.get(category, "") if category else ""

    async def _query_court(court: str) -> tuple[list[dict], int]:
        params: dict = {
            "Applikation": court,
            "DokumenteProSeite": DOCS_PER_PAGE,
            "Seitennummer": page,
            "EntscheidungsdatumVon": date_from,
        }
        if suchworte:
            params["Suchworte"] = suchworte

        url = f"{settings.RIS_API_BASE_URL}/Judikatur"
        data = await _fetch(url, params)
        refs = _extract_refs(data)
        hits = _extract_hits(data)
        results = []
        for ref in refs:
            parsed = _parse_judikatur_doc(ref, court)
            if parsed:
                results.append(parsed)
        return results, hits

    # Query all courts in parallel
    court_results = await asyncio.gather(*[_query_court(c) for c in courts])

    all_results: list[dict] = []
    total_hits = 0
    for results, hits in court_results:
        all_results.extend(results)
        total_hits += hits

    return {"results": all_results, "total_hits": total_hits}


async def _fetch(url: str, params: dict) -> dict:
    """Execute HTTP GET against RIS API."""
    logger.info(f"RIS API: GET {url} params={params}")
    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            resp = await client.get(url, params=params)
            resp.raise_for_status()
            data = resp.json()
            # Log hit count and first doc structure for debugging
            refs = _extract_refs(data)
            hits = _extract_hits(data)
            logger.info(f"RIS API: {hits} hits, {len(refs)} refs returned")
            if refs:
                first = refs[0]
                data_keys = list(first.get("Data", {}).keys())
                meta_keys = list(first.get("Data", {}).get("Metadaten", {}).keys())
                logger.info(f"First doc: Data keys={data_keys}, Metadaten keys={meta_keys}")
            return data
        except httpx.HTTPStatusError as e:
            logger.error(f"RIS HTTP {e.response.status_code}: {e.response.text[:500]}")
            return _empty()
        except httpx.RequestError as e:
            logger.error(f"RIS request error: {e}")
            return _empty()


def _empty() -> dict:
    return {"OgdSearchResult": {"OgdDocumentResults": {"OgdDocumentReference": [], "Hits": {"#text": "0"}}}}


def _timeframe_to_days(im_ris_seit: str) -> int:
    for tf in TIMEFRAMES:
        if tf["value"] == im_ris_seit:
            return tf["days"]
    return 31


# ── Response Parsing ──

def _extract_refs(data: dict) -> list[dict]:
    refs = (
        data.get("OgdSearchResult", {})
        .get("OgdDocumentResults", {})
        .get("OgdDocumentReference", [])
    )
    if isinstance(refs, dict):
        refs = [refs]
    return refs or []


def _extract_hits(data: dict) -> int:
    hits = (
        data.get("OgdSearchResult", {})
        .get("OgdDocumentResults", {})
        .get("Hits", {})
    )
    if isinstance(hits, dict):
        text = hits.get("#text", "0")
    else:
        text = str(hits)
    try:
        return int(text)
    except (ValueError, TypeError):
        return 0


def _collect_metadata(metadata: dict, section_keys: list[str]) -> dict:
    """Merge nested metadata sections into a flat dict."""
    merged: dict = {}
    for key in section_keys:
        section = metadata.get(key)
        if isinstance(section, list) and section and isinstance(section[0], dict):
            section = section[0]
        if isinstance(section, dict):
            merged.update(section)
            # One level deeper (e.g., Bundesrecht.BrKons)
            for subkey in ("BrKons", "LrKons", "Justiz", "Vfgh", "Vwgh", "Bvwg", "Lvwg"):
                sub = section.get(subkey)
                if isinstance(sub, list) and sub and isinstance(sub[0], dict):
                    sub = sub[0]
                if isinstance(sub, dict):
                    merged.update(sub)
    # Fallback: fields directly on metadata
    known = {"Kurztitel", "Langtitel", "Dokumentnummer", "DokumentUrl"}
    if not merged or not (known & set(merged.keys())):
        if known & set(metadata.keys()):
            merged.update(metadata)
    return merged


def _s(val) -> str:
    """Coerce API value to string."""
    if val is None:
        return ""
    if isinstance(val, str):
        return val
    if isinstance(val, list):
        return ", ".join(str(v) for v in val)
    return str(val)


def _extract_doc_url(m: dict, ref: dict, data_entry: dict) -> str:
    """Build URL to the specific changed section (Normabschnitt).

    Uses the NOR document ID to build a direct Dokument.wxe link,
    which opens only the specific changed section, not the full law.
    Falls back to the ELI DokumentUrl if no NOR ID is available.
    """
    doc_id = (
        _s(m.get("ID"))
        or _s(m.get("Dokumentnummer"))
        or _s(data_entry.get("Dokumentnummer"))
        or _s(ref.get("Dokumentnummer"))
    )
    if doc_id and doc_id.startswith("NOR"):
        return f"https://www.ris.bka.gv.at/Dokument.wxe?Abfrage=Bundesnormen&Dokumentnummer={doc_id}"
    return (
        _s(m.get("DokumentUrl"))
        or _s(ref.get("DokumentUrl"))
        or _s(data_entry.get("DokumentUrl"))
        or ""
    )


def _extract_id(m: dict, ref: dict, data_entry: dict) -> str:
    """Find document ID from multiple possible locations.

    In v2.6: Metadaten.Technisch.ID is the primary location.
    """
    doc_id = (
        _s(m.get("ID"))
        or _s(m.get("Dokumentnummer"))
        or _s(data_entry.get("Dokumentnummer"))
        or _s(ref.get("Dokumentnummer"))
    )
    if not doc_id:
        # Try extracting from URL
        url = _extract_doc_url(m, ref, data_entry)
        for part in url.split("&"):
            if "=" in part:
                key, _, val = part.partition("=")
                if key.split("?")[-1] == "Dokumentnummer" and val:
                    return val
    return doc_id


def parse_bundesrecht_response(data: dict) -> dict:
    """Parse Bundesrecht API response into a list of result dicts."""
    refs = _extract_refs(data)
    total_hits = _extract_hits(data)
    results = []

    for ref in refs:
        data_entry = ref.get("Data", {})
        metadata = data_entry.get("Metadaten", {})
        m = _collect_metadata(metadata, ["Technisch", "Allgemein", "Bundesrecht", "BrKons"])

        doc_id = _extract_id(m, ref, data_entry)
        if not doc_id:
            continue

        title = _s(m.get("Kurztitel")) or _s(m.get("Langtitel")) or _s(m.get("Titel")) or doc_id
        long_title = _s(m.get("Langtitel")) or title
        doc_url = _extract_doc_url(m, ref, data_entry)
        change_date = _s(m.get("Inkrafttretensdatum")) or _s(m.get("Aenderungsdatum")) or _s(m.get("Geaendert")) or ""
        bgbl = _s(m.get("Kundmachungsorgan")) or _s(m.get("Aenderung")) or ""
        typ = _s(m.get("Typ")) or ""
        artikel = _s(m.get("ArtikelParagraphAnlage")) or ""

        results.append({
            "id": doc_id,
            "title": title,
            "long_title": long_title,
            "url": doc_url,
            "date": change_date,
            "bgbl": bgbl,
            "typ": typ,
            "artikel": artikel,
        })

    return {"results": results, "total_hits": total_hits}


def _parse_judikatur_doc(ref: dict, court_app: str) -> dict | None:
    """Parse a single Judikatur document reference."""
    data_entry = ref.get("Data", {})
    metadata = data_entry.get("Metadaten", {})
    m = _collect_metadata(metadata, ["Technisch", "Allgemein", "Judikatur", court_app])

    doc_id = _extract_id(m, ref, data_entry)
    if not doc_id:
        return None

    case_number = _s(m.get("Geschaeftszahl")) or _s(data_entry.get("Geschaeftszahl")) or ""
    court_name = _s(m.get("Gericht")) or _s(data_entry.get("Gericht")) or court_app
    title = _s(m.get("Kurztitel")) or _s(m.get("Betreff")) or f"{court_name} {case_number}"
    doc_url = _extract_doc_url(m, ref, data_entry)
    decision_date = _s(m.get("Entscheidungsdatum")) or _s(data_entry.get("Entscheidungsdatum")) or ""
    normen = _s(m.get("Norm")) or ""

    return {
        "id": doc_id,
        "title": title,
        "url": doc_url,
        "date": decision_date,
        "case_number": case_number,
        "court": court_name,
        "normen": normen,
    }
