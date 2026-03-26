"""Client for the Austrian RIS (Rechtsinformationssystem) OGD API v2.6.

Supports two document types:
  - Gesetze und Verordnungen (Bundesrecht consolidated)
  - Gerichtsentscheidungen (Judikatur from all court sources)

Filters out expired provisions (Ausserkrafttretensdatum < today).
"""

import asyncio
import logging
from datetime import date, datetime, timedelta

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

# ── Rechtsgebiete ──
# Each category maps to RIS Index numbers (official Austrian legal classification).
# The Index parameter IS supported for BrKons (contrary to the old comment).
# Format: "XX/YY" where XX = Hauptgruppe, YY = Untergruppe.
# Using just "XX" matches all Untergruppen of that Hauptgruppe.

LEGAL_CATEGORIES = [
    # ── Verfassungsrecht ──
    {"id": "verfassungsrecht", "label": "Verfassungsrecht", "group": "Öffentliches Recht"},
    {"id": "grundrechte", "label": "Grundrechte / Datenschutz", "group": "Öffentliches Recht"},
    {"id": "wahlrecht", "label": "Wahl- und Parteienrecht", "group": "Öffentliches Recht"},
    # ── Verwaltungsrecht ──
    {"id": "verwaltungsrecht", "label": "Verwaltungsverfahren", "group": "Verwaltungsrecht"},
    {"id": "sicherheitspolizei", "label": "Sicherheitspolizeirecht", "group": "Verwaltungsrecht"},
    {"id": "staatsbuergerschaft", "label": "Staatsbürgerschaft / Meldewesen", "group": "Verwaltungsrecht"},
    {"id": "fremdenrecht", "label": "Fremden- und Asylrecht", "group": "Verwaltungsrecht"},
    {"id": "beamtenrecht", "label": "Beamten- und Dienstrecht", "group": "Verwaltungsrecht"},
    # ── Privatrecht ──
    {"id": "zivilrecht", "label": "Bürgerliches Recht (ABGB)", "group": "Privatrecht"},
    {"id": "handelsrecht", "label": "Handelsrecht / UGB", "group": "Privatrecht"},
    {"id": "gesellschaftsrecht", "label": "Gesellschaftsrecht (GmbHG, AktG)", "group": "Privatrecht"},
    {"id": "genossenschaftsrecht", "label": "Genossenschaftsrecht", "group": "Privatrecht"},
    {"id": "wertpapierrecht", "label": "Wertpapierrecht", "group": "Privatrecht"},
    {"id": "immaterialgueter", "label": "Gewerblicher Rechtsschutz / Urheberrecht", "group": "Privatrecht"},
    # ── Verfahrensrecht ──
    {"id": "zivilprozess", "label": "Zivilprozessrecht", "group": "Verfahrensrecht"},
    {"id": "ausserstreit", "label": "Außerstreitverfahren", "group": "Verfahrensrecht"},
    {"id": "exekutionsrecht", "label": "Exekutions- und Insolvenzrecht", "group": "Verfahrensrecht"},
    {"id": "justizverwaltung", "label": "Justizverwaltung / Notariatswesen", "group": "Verfahrensrecht"},
    # ── Strafrecht ──
    {"id": "strafrecht", "label": "Strafrecht (StGB)", "group": "Strafrecht"},
    {"id": "strafprozess", "label": "Strafprozessrecht (StPO)", "group": "Strafrecht"},
    {"id": "strafvollzug", "label": "Strafvollzug", "group": "Strafrecht"},
    # ── Finanz- und Steuerrecht ──
    {"id": "finanzrecht", "label": "Finanzrecht allgemein / Haushaltsrecht", "group": "Steuerrecht"},
    {"id": "steuerrecht", "label": "Steuerrecht", "group": "Steuerrecht"},
    {"id": "zollrecht", "label": "Zollrecht", "group": "Steuerrecht"},
    {"id": "finanzausgleich", "label": "Finanzausgleich", "group": "Steuerrecht"},
    # ── Arbeits- und Sozialrecht ──
    {"id": "arbeitsrecht", "label": "Arbeitsrecht", "group": "Arbeits- und Sozialrecht"},
    {"id": "sozialversicherung", "label": "Sozialversicherungsrecht", "group": "Arbeits- und Sozialrecht"},
    # ── Gewerbe, Industrie, Verkehr ──
    {"id": "gewerberecht", "label": "Gewerberecht", "group": "Wirtschaftsrecht"},
    {"id": "energierecht", "label": "Energierecht", "group": "Wirtschaftsrecht"},
    {"id": "verkehrsrecht", "label": "Verkehrsrecht", "group": "Wirtschaftsrecht"},
    # ── Bildung, Wissenschaft ──
    {"id": "schulrecht", "label": "Schulwesen", "group": "Bildung & Kultur"},
    {"id": "hochschulrecht", "label": "Hochschulwesen", "group": "Bildung & Kultur"},
    # ── Gesundheit, Umwelt ──
    {"id": "gesundheitsrecht", "label": "Gesundheitsrecht", "group": "Gesundheit & Umwelt"},
    {"id": "umweltrecht", "label": "Naturschutz / Umweltschutz", "group": "Gesundheit & Umwelt"},
    {"id": "landwirtschaft", "label": "Land- und Forstwirtschaft", "group": "Gesundheit & Umwelt"},
    # ── Äußeres, Landesverteidigung ──
    {"id": "aeusseres", "label": "Äußere Angelegenheiten", "group": "Internationales"},
    {"id": "landesverteidigung", "label": "Landesverteidigung", "group": "Internationales"},
]

# ── RIS Index mapping per Rechtsgebiet ──
# Uses the official Austrian legal classification (Systematische Dezimalklassifikation).
# Format: "XX/YY" where XX = Hauptgruppe, YY = Untergruppe.
# Using just "XX" should match all Untergruppen of that Hauptgruppe.
_CATEGORY_INDEX: dict[str, list[str]] = {
    # Verfassungsrecht (Sachgebiet 0/1)
    "verfassungsrecht": ["10"],        # 10 = Verfassungsrecht (all subgroups)
    "grundrechte": ["10/10"],          # 10/10 = Grundrechte, Datenschutz
    "wahlrecht": ["10/04", "10/12"],   # 10/04 Wahlen, 10/12 Politische Parteien
    # Verwaltungsrecht
    "verwaltungsrecht": ["40"],        # 40 = Verwaltungsverfahren (all subgroups)
    "sicherheitspolizei": ["43"],      # 43 = Sicherheitspolizei
    "staatsbuergerschaft": ["41"],     # 41 = Staatsbürgerschaft, Pass/Meldewesen
    "fremdenrecht": ["41"],            # Also under 41
    "beamtenrecht": ["62"],            # 62 = Dienstrecht
    # Privatrecht (Sachgebiet 2)
    "zivilrecht": ["20"],              # 20 = Bürgerliches Recht (all subgroups)
    "handelsrecht": ["21/01"],         # 21/01 = Handelsrecht
    "gesellschaftsrecht": ["21/02", "21/03", "21/04"],  # GmbH, AG, Genossenschaften
    "genossenschaftsrecht": ["21/04"], # 21/04 = Genossenschaftsrecht
    "wertpapierrecht": ["21/05"],      # 21/05 = Wertpapierrecht
    "immaterialgueter": ["26"],        # 26 = Gewerblicher Rechtsschutz
    # Verfahrensrecht
    "zivilprozess": ["21/01"],         # Zivilprozess under 21
    "ausserstreit": ["22"],            # 22 = Außerstreitverfahren
    "exekutionsrecht": ["23"],         # 23 = Exekutions-/Insolvenzrecht
    "justizverwaltung": ["24", "25"],  # 24 = Justizverwaltung, 25 = Notariatswesen
    # Strafrecht (Sachgebiet 9)
    "strafrecht": ["90"],              # 90 = Strafrechtswesen
    "strafprozess": ["91"],            # 91 = Strafprozessrecht
    "strafvollzug": ["92"],            # 92 = Strafvollzug
    # Finanzrecht (Sachgebiet 3)
    "finanzrecht": ["30"],             # 30 = Finanzrecht allgemein
    "steuerrecht": ["32"],             # 32 = Steuerrecht
    "zollrecht": ["34"],               # 34 = Zollrecht
    "finanzausgleich": ["35"],         # 35 = Finanzausgleich
    # Arbeits-/Sozialrecht (Sachgebiet 6)
    "arbeitsrecht": ["60"],            # 60 = Arbeitsrecht
    "sozialversicherung": ["66"],      # 66 = Sozialversicherungsrecht
    # Gewerbe/Verkehr (Sachgebiet 5)
    "gewerberecht": ["50"],            # 50 = Gewerberecht
    "energierecht": ["58"],            # 58 = Energierecht
    "verkehrsrecht": ["55"],           # 55 = Verkehrsrecht
    # Bildung (Sachgebiet 7)
    "schulrecht": ["70"],              # 70 = Schulwesen
    "hochschulrecht": ["72"],          # 72 = Hochschulwesen
    # Gesundheit/Umwelt (Sachgebiet 8)
    "gesundheitsrecht": ["82"],        # 82 = Gesundheitsrecht
    "umweltrecht": ["83"],             # 83 = Naturschutz/Umweltschutz
    "landwirtschaft": ["80"],          # 80 = Land-/Forstwirtschaft
    # Äußeres/Verteidigung (Sachgebiet 1)
    "aeusseres": ["11"],               # 11 = Äußere Angelegenheiten
    "landesverteidigung": ["12"],      # 12 = Landesverteidigung
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
    # Verfassungsrecht → VfGH
    "verfassungsrecht": ["Vfgh"],
    "grundrechte": ["Vfgh"],
    # Verwaltungsrecht → VwGH, BVwG, LVwG
    "verwaltungsrecht": ["Vwgh", "Bvwg", "Lvwg"],
    "sicherheitspolizei": ["Vwgh", "Bvwg"],
    "staatsbuergerschaft": ["Vwgh", "Bvwg"],
    "fremdenrecht": ["Vwgh", "Bvwg"],
    "beamtenrecht": ["Vwgh", "Bvwg"],
    # Privatrecht → Ordentliche Gerichte
    "zivilrecht": ["Justiz"],
    "handelsrecht": ["Justiz"],
    "gesellschaftsrecht": ["Justiz"],
    "genossenschaftsrecht": ["Justiz"],
    "wertpapierrecht": ["Justiz"],
    "immaterialgueter": ["Justiz"],
    # Verfahrensrecht
    "zivilprozess": ["Justiz"],
    "ausserstreit": ["Justiz"],
    "exekutionsrecht": ["Justiz"],
    "justizverwaltung": ["Justiz"],
    # Strafrecht
    "strafrecht": ["Justiz"],
    "strafprozess": ["Justiz"],
    "strafvollzug": ["Justiz"],
    "finanzrecht": ["Vwgh", "Bvwg"],
    "steuerrecht": ["Vwgh", "Bvwg"],
    "zollrecht": ["Vwgh", "Bvwg"],
    "finanzausgleich": ["Vwgh", "Bvwg"],
    # Arbeitsrecht
    "arbeitsrecht": ["Justiz"],
    "sozialversicherung": ["Vwgh", "Bvwg"],
    # Gewerbe/Verkehr
    "gewerberecht": ["Vwgh", "Bvwg", "Lvwg"],
    "energierecht": ["Vwgh", "Bvwg"],
    "verkehrsrecht": ["Vwgh", "Bvwg", "Lvwg"],
    # Gesundheit/Umwelt
    "gesundheitsrecht": ["Vwgh", "Bvwg"],
    "umweltrecht": ["Vwgh", "Bvwg", "Lvwg"],
    "landwirtschaft": ["Vwgh", "Bvwg"],
    # Äußeres
    "aeusseres": ["Vfgh", "Vwgh"],
    "landesverteidigung": ["Vwgh", "Bvwg"],
}

# DokumenteProSeite enum
DOCS_PER_PAGE = "Twenty"


# ── API Calls ──

async def search_gesetze(
    category: str,
    im_ris_seit: str,
    page: int = 1,
) -> dict:
    """Search Bundesrecht for provisions that ACTUALLY CHANGED in the timeframe.

    Uses RIS Index (official legal classification) + Fassung.VonInkrafttretensdatum
    to find provisions with real legislative changes.

    Strategy:
      - Category with Index mapping → query each Index with Inkrafttreten date range
      - No category → query all with ImRisSeit fallback
    """
    indices = _CATEGORY_INDEX.get(category, []) if category else []

    if indices:
        return await _search_by_indices(indices, im_ris_seit, page)
    else:
        # No category selected or unknown → broad search
        params: dict = {
            "Applikation": "BrKons",
            "DokumenteProSeite": DOCS_PER_PAGE,
            "Seitennummer": page,
            "ImRisSeit": im_ris_seit,
        }
        url = f"{settings.RIS_API_BASE_URL}/Bundesrecht"
        return await _fetch(url, params)


async def _search_by_indices(
    indices: list[str],
    im_ris_seit: str,
    page: int,
) -> dict:
    """Query RIS by Index numbers + ImRisSeit timeframe.

    Uses Index for Rechtsgebiet filtering + ImRisSeit for timeframe.
    Falls back to Suchworte if Index returns 0 hits.
    """

    async def _query_one(index: str) -> dict:
        # Try Index + ImRisSeit first
        params = {
            "Applikation": "BrKons",
            "Index": index,
            "ImRisSeit": im_ris_seit,
            "DokumenteProSeite": "OneHundred",
            "Seitennummer": page,
        }
        url = f"{settings.RIS_API_BASE_URL}/Bundesrecht"
        result = await _fetch(url, params)

        # If 0 hits, try with Suchworte instead of Index
        if _extract_hits(result) == 0:
            logger.info(f"Index={index} returned 0 hits, trying Suchworte fallback")
            params2 = {
                "Applikation": "BrKons",
                "Suchworte": index,  # Use the index number as search term
                "ImRisSeit": im_ris_seit,
                "DokumenteProSeite": "OneHundred",
                "Seitennummer": page,
            }
            result = await _fetch(url, params2)

        return result
        url = f"{settings.RIS_API_BASE_URL}/Bundesrecht"
        return await _fetch(url, params)

    raw_results = await asyncio.gather(*[_query_one(idx) for idx in indices])

    # Combine all results
    all_refs: list[dict] = []
    total_hits = 0
    for raw in raw_results:
        refs = _extract_refs(raw)
        hits = _extract_hits(raw)
        all_refs.extend(refs)
        total_hits += hits

    # Build a combined response structure
    return {
        "OgdSearchResult": {
            "OgdDocumentResults": {
                "OgdDocumentReference": all_refs,
                "Hits": {"#text": str(total_hits)},
            }
        }
    }


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

    # Use Index numbers as Suchworte for Judikatur filtering
    # (Judikatur doesn't support Index parameter directly, but Suchworte works)
    indices = _CATEGORY_INDEX.get(category, []) if category else []
    # Build search terms from the category label
    suchworte = ""
    if category:
        for cat in LEGAL_CATEGORIES:
            if cat["id"] == category:
                suchworte = cat["label"].split("(")[0].split("/")[0].strip()
                break

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


def _date_before(date_a: str, date_b: str) -> bool:
    """Check if date_a < date_b (provision superseded before taking effect)."""
    def _parse(s):
        s = s.strip()
        for fmt in ("%Y-%m-%d", "%d.%m.%Y", "%Y-%m-%dT%H:%M:%S"):
            try:
                return datetime.strptime(s.split("+")[0], fmt).date()
            except ValueError:
                continue
        return None
    a, b = _parse(date_a), _parse(date_b)
    if a and b:
        return a < b
    return False


def _is_expired_before(ausserkraft_str: str, days_ago: int) -> bool:
    """Check if a provision expired BEFORE the search timeframe.

    Returns True only if Ausserkrafttretensdatum < (today - days_ago).
    Provisions that expired WITHIN the timeframe are still relevant changes.
    """
    if not ausserkraft_str:
        return False
    s = ausserkraft_str.strip()
    if s in ("9999-12-31", "31.12.9999"):
        return False
    cutoff = date.today() - timedelta(days=days_ago)
    for fmt in ("%Y-%m-%d", "%d.%m.%Y", "%Y-%m-%dT%H:%M:%S"):
        try:
            dt = datetime.strptime(s.split("+")[0], fmt)
            return dt.date() < cutoff
        except ValueError:
            continue
    return False


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
        # Inkrafttretensdatum = when this version of the law took effect
        change_date = _s(m.get("Inkrafttretensdatum")) or _s(m.get("Aenderungsdatum")) or _s(m.get("Geaendert")) or ""
        bgbl = _s(m.get("Kundmachungsorgan")) or _s(m.get("Aenderung")) or ""
        typ = _s(m.get("Typ")) or ""
        artikel = _s(m.get("ArtikelParagraphAnlage")) or ""
        # When the RIS database entry was last updated (metadata refresh)
        ris_updated = _s(m.get("ZuletztAktualisiert")) or _s(m.get("GeaendertAm")) or ""
        # Index field from RIS (e.g., "21/01 Handelsrecht")
        index_text = _s(m.get("Index")) or ""
        # Gesetzesnummer for version comparison
        gesetzesnummer = _s(m.get("Gesetzesnummer")) or _s(data_entry.get("Gesetzesnummer")) or ""
        # Außerkrafttretensdatum - if set and in the past, provision is no longer in force
        ausserkraft = _s(m.get("Ausserkrafttretensdatum")) or ""

        # Skip provisions superseded before taking effect (Ausserkraft < Inkraft)
        # These were overtaken by a later amendment before they ever became valid.
        if ausserkraft and change_date and _date_before(ausserkraft, change_date):
            continue

        results.append({
            "id": doc_id,
            "title": title,
            "long_title": long_title,
            "url": doc_url,
            "date": change_date,
            "bgbl": bgbl,
            "typ": typ,
            "artikel": artikel,
            "ris_updated": ris_updated,
            "index": index_text,
            "gesetzesnummer": gesetzesnummer,
            "ausserkraft": ausserkraft,
        })

    # Deduplicate: if an expired version AND a newer version of the same
    # Gesetzesnummer + Artikel exist, keep only the newer one.
    # This avoids showing both the old and new § 275 when only the new one was amended.
    results = _dedup_provisions(results)

    return {"results": results, "total_hits": total_hits}


def _dedup_provisions(results: list[dict]) -> list[dict]:
    """Remove expired provisions when a newer version of the same § exists."""
    # Group by (gesetzesnummer, artikel)
    from collections import defaultdict
    groups: dict[tuple, list[dict]] = defaultdict(list)
    for r in results:
        key = (r.get("gesetzesnummer", ""), r.get("artikel", ""))
        if key[0] and key[1]:
            groups[key].append(r)

    # Find IDs to remove
    remove_ids = set()
    for key, group in groups.items():
        if len(group) <= 1:
            continue
        # Sort by date descending
        sorted_g = sorted(group, key=lambda x: x.get("date", ""), reverse=True)
        newest = sorted_g[0]
        for older in sorted_g[1:]:
            # If the older version has an ausserkraft date, it's superseded
            if older.get("ausserkraft"):
                remove_ids.add(older["id"])

    if remove_ids:
        logger.info(f"Dedup: removing {len(remove_ids)} superseded provisions: {remove_ids}")
        results = [r for r in results if r["id"] not in remove_ids]

    return results


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
