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
# Complete Austrian RIS Index (Systematische Dezimalklassifikation des Bundesrechts).
# Validated: Index=XX/YY works with BrKons API. Index=XX (Hauptgruppe only) returns 0.

LEGAL_CATEGORIES = [
    # ── Kernrechtsgebiete (priority, shown first) ──
    {"id": "einkommensteuer", "label": "Steuerrecht", "group": "Kernrechtsgebiete"},
    {"id": "zivilrecht", "label": "Bürgerliches Recht", "group": "Kernrechtsgebiete"},
    {"id": "handelsrecht", "label": "Unternehmensrecht", "group": "Kernrechtsgebiete"},
    {"id": "gmbh_recht", "label": "Gesellschaftsrecht", "group": "Kernrechtsgebiete"},
    {"id": "bankrecht", "label": "Bank- und Kapitalmarktrecht", "group": "Kernrechtsgebiete"},
    {"id": "wertpapierrecht", "label": "Wertpapier- und Börserecht", "group": "Kernrechtsgebiete"},
    {"id": "zivilprozess", "label": "Zivilgerichtliches Verfahren", "group": "Kernrechtsgebiete"},
    {"id": "vergaberecht", "label": "Vergaberecht", "group": "Kernrechtsgebiete"},
    {"id": "verwaltungsverfahren", "label": "Verwaltungsverfahrensrecht", "group": "Kernrechtsgebiete"},
    # ── 0/1: Verfassungsrecht, Äußeres, Verteidigung ──
    {"id": "verfassungsrecht", "label": "Verfassungsrecht", "group": "Verfassungsrecht"},
    {"id": "grundrechte", "label": "Grundrechte / Datenschutz / Auskunftspflicht", "group": "Verfassungsrecht"},
    {"id": "wahlen", "label": "Wahlen / Parteien / Volksbegehren", "group": "Verfassungsrecht"},
    {"id": "bezuege", "label": "Bezüge / Unvereinbarkeit", "group": "Verfassungsrecht"},
    {"id": "verfassungsgerichtsbarkeit", "label": "Verfassungs- und Verwaltungsgerichtsbarkeit", "group": "Verfassungsrecht"},
    {"id": "rechnungshof", "label": "Rechnungshof / Volksanwaltschaft", "group": "Verfassungsrecht"},
    {"id": "amtshaftung", "label": "Amtshaftung / Organhaftpflicht", "group": "Verfassungsrecht"},
    {"id": "eu_integration", "label": "Europäische Integration", "group": "Verfassungsrecht"},
    {"id": "aeusseres", "label": "Äußere Angelegenheiten", "group": "Äußeres & Verteidigung"},
    {"id": "landesverteidigung", "label": "Landesverteidigung / Heer", "group": "Äußeres & Verteidigung"},
    {"id": "zivildienst", "label": "Zivildienst", "group": "Äußeres & Verteidigung"},
    {"id": "voelkerrecht", "label": "Völkerrechtliche Verträge", "group": "Äußeres & Verteidigung"},
    # ── 2: Privatrecht ──
    {"id": "aktienrecht", "label": "Aktienrecht", "group": "Privatrecht"},
    {"id": "genossenschaftsrecht", "label": "Genossenschaftsrecht", "group": "Privatrecht"},
    {"id": "versicherungsrecht", "label": "Versicherungsrecht", "group": "Privatrecht"},
    {"id": "ausserstreit", "label": "Außerstreitverfahren", "group": "Verfahrensrecht"},
    {"id": "exekutionsrecht", "label": "Exekutionsrecht", "group": "Verfahrensrecht"},
    {"id": "insolvenzrecht", "label": "Insolvenzrecht", "group": "Verfahrensrecht"},
    {"id": "justizverwaltung", "label": "Justizverwaltung", "group": "Verfahrensrecht"},
    {"id": "notariat", "label": "Notariatswesen", "group": "Verfahrensrecht"},
    {"id": "urheberrecht", "label": "Urheberrecht", "group": "Gewerblicher Rechtsschutz"},
    {"id": "patentrecht", "label": "Patentrecht / Markenrecht / Musterschutz", "group": "Gewerblicher Rechtsschutz"},
    # ── 3: Finanzrecht ──
    {"id": "finanzrecht_allg", "label": "Finanzrecht allgemein / Haushaltsrecht", "group": "Finanzrecht"},
    {"id": "abgabenrecht", "label": "Abgabenverfahrensrecht", "group": "Finanzrecht"},
    {"id": "koerperschaftsteuer", "label": "Körperschaftsteuer", "group": "Steuerrecht"},
    {"id": "umsatzsteuer", "label": "Umsatzsteuer", "group": "Steuerrecht"},
    {"id": "gebuehrenrecht", "label": "Gebührenrecht / Verkehrsteuern", "group": "Steuerrecht"},
    {"id": "bewertungsrecht", "label": "Bewertungsrecht", "group": "Steuerrecht"},
    {"id": "zollrecht", "label": "Zollrecht", "group": "Steuerrecht"},
    {"id": "finanzausgleich", "label": "Finanzausgleich", "group": "Steuerrecht"},
    {"id": "finanzstrafrecht", "label": "Finanzstrafrecht", "group": "Steuerrecht"},
    # ── 4: Innere Verwaltung ──
    {"id": "staatsbuergerschaft", "label": "Staatsbürgerschaft / Pass- / Meldewesen", "group": "Verwaltungsrecht"},
    {"id": "personenstandsrecht", "label": "Personenstandsrecht", "group": "Verwaltungsrecht"},
    {"id": "sicherheitspolizei", "label": "Sicherheitspolizei", "group": "Verwaltungsrecht"},
    {"id": "fremdenrecht", "label": "Fremden- und Asylrecht", "group": "Verwaltungsrecht"},
    {"id": "waffenrecht", "label": "Waffenrecht", "group": "Verwaltungsrecht"},
    {"id": "vereinsrecht", "label": "Vereins- und Versammlungsrecht", "group": "Verwaltungsrecht"},
    {"id": "datenschutz", "label": "Datenschutz", "group": "Verwaltungsrecht"},
    # ── 5: Gewerbe, Industrie, Handel, Verkehr ──
    {"id": "gewerberecht", "label": "Gewerberecht", "group": "Wirtschaftsrecht"},
    {"id": "bergrecht", "label": "Bergrecht", "group": "Wirtschaftsrecht"},
    {"id": "energierecht", "label": "Energierecht", "group": "Wirtschaftsrecht"},
    {"id": "preisrecht", "label": "Preisrecht / Wettbewerbsrecht", "group": "Wirtschaftsrecht"},
    {"id": "verkehrsrecht", "label": "Verkehrsrecht", "group": "Wirtschaftsrecht"},
    {"id": "schifffahrt", "label": "Schifffahrtsrecht", "group": "Wirtschaftsrecht"},
    {"id": "luftfahrt", "label": "Luftfahrtrecht", "group": "Wirtschaftsrecht"},
    {"id": "eisenbahn", "label": "Eisenbahnrecht", "group": "Wirtschaftsrecht"},
    {"id": "telekommunikation", "label": "Telekommunikation / Medien", "group": "Wirtschaftsrecht"},
    {"id": "postrecht", "label": "Postrecht", "group": "Wirtschaftsrecht"},
    # ── 6: Arbeitsrecht, Dienstrecht, Sozialrecht ──
    {"id": "arbeitsrecht", "label": "Arbeitsrecht", "group": "Arbeits- & Sozialrecht"},
    {"id": "arbeitsschutz", "label": "ArbeitnehmerInnenschutz", "group": "Arbeits- & Sozialrecht"},
    {"id": "arbeitsmarkt", "label": "Arbeitsmarktrecht / Arbeitslosenversicherung", "group": "Arbeits- & Sozialrecht"},
    {"id": "beamtendienstrecht", "label": "Beamtendienstrecht", "group": "Arbeits- & Sozialrecht"},
    {"id": "personalvertretung", "label": "Personalvertretungsrecht", "group": "Arbeits- & Sozialrecht"},
    {"id": "sozialversicherung", "label": "Sozialversicherungsrecht", "group": "Arbeits- & Sozialrecht"},
    {"id": "pensionsrecht", "label": "Pensionsrecht", "group": "Arbeits- & Sozialrecht"},
    {"id": "pflegegeld", "label": "Pflegegeld / Behindertenrecht", "group": "Arbeits- & Sozialrecht"},
    {"id": "sozialhilfe", "label": "Sozialhilfe / Grundversorgung", "group": "Arbeits- & Sozialrecht"},
    # ── 7: Unterricht, Wissenschaft, Kultur ──
    {"id": "schulrecht", "label": "Schulrecht", "group": "Bildung & Kultur"},
    {"id": "hochschulrecht", "label": "Hochschulrecht", "group": "Bildung & Kultur"},
    {"id": "forschung", "label": "Forschung / Wissenschaft", "group": "Bildung & Kultur"},
    {"id": "kulturrecht", "label": "Kunst / Kultur / Denkmalschutz", "group": "Bildung & Kultur"},
    {"id": "medienfoerderung", "label": "Medienförderung / Pressewesen", "group": "Bildung & Kultur"},
    {"id": "sportrecht", "label": "Sportrecht", "group": "Bildung & Kultur"},
    # ── 8: Land-/Forstwirtschaft, Gesundheit, Umwelt ──
    {"id": "landwirtschaft", "label": "Land- und Forstwirtschaft", "group": "Gesundheit & Umwelt"},
    {"id": "tierschutz", "label": "Tierschutz / Veterinärrecht", "group": "Gesundheit & Umwelt"},
    {"id": "wasserrecht", "label": "Wasserrecht", "group": "Gesundheit & Umwelt"},
    {"id": "gesundheitsrecht", "label": "Gesundheitsrecht / Krankenanstalten", "group": "Gesundheit & Umwelt"},
    {"id": "arzneimittelrecht", "label": "Arzneimittelrecht", "group": "Gesundheit & Umwelt"},
    {"id": "lebensmittelrecht", "label": "Lebensmittelrecht", "group": "Gesundheit & Umwelt"},
    {"id": "umweltrecht", "label": "Umweltschutz / Klimaschutz", "group": "Gesundheit & Umwelt"},
    {"id": "abfallrecht", "label": "Abfallwirtschaft", "group": "Gesundheit & Umwelt"},
    {"id": "chemikalienrecht", "label": "Chemikalienrecht / Gentechnik", "group": "Gesundheit & Umwelt"},
    # ── 9: Strafrecht ──
    {"id": "strafrecht", "label": "Strafrecht", "group": "Strafrecht"},
    {"id": "nebenstrafrecht", "label": "Nebenstrafrecht", "group": "Strafrecht"},
    {"id": "strafprozess", "label": "Strafprozessrecht", "group": "Strafrecht"},
    {"id": "strafvollzug", "label": "Strafvollzug", "group": "Strafrecht"},
    {"id": "opferschutz", "label": "Opferschutz / Bewährungshilfe", "group": "Strafrecht"},
    # ── Sonderquellen ──
    {"id": "unionsrecht", "label": "Unionsrecht (EU)", "group": "EU / International"},
]

# ── RIS Index mapping per Rechtsgebiet ──
# Uses the official Austrian legal classification (Systematische Dezimalklassifikation).
# Format: "XX/YY" where XX = Hauptgruppe, YY = Untergruppe.
# Using just "XX" should match all Untergruppen of that Hauptgruppe.
# Validated: Index=XX/YY works. Index=XX (Hauptgruppe only) returns 0.
# Fallback: Titel parameter for specific laws.
_CATEGORY_SEARCH: dict[str, list[dict]] = {
    # 1: Verfassungsrecht (10-19)
    "verfassungsrecht": [{"Index": "10/01"}, {"Index": "10/02"}, {"Index": "10/03"}, {"Index": "10/14"}],
    "grundrechte": [{"Index": "10/10"}, {"Index": "10/11"}],
    "wahlen": [{"Index": "10/04"}, {"Index": "10/06"}, {"Index": "10/12"}],
    "bezuege": [{"Index": "10/05"}],
    "verfassungsgerichtsbarkeit": [{"Index": "10/07"}],
    "rechnungshof": [{"Index": "10/08"}],
    "amtshaftung": [{"Index": "10/13"}],
    "eu_integration": [{"Index": "10/15"}],
    "aeusseres": [{"Index": "11/01"}, {"Index": "11/02"}, {"Index": "11/03"}, {"Index": "11/04"}],
    "landesverteidigung": [{"Index": "43/01"}, {"Index": "43/02"}, {"Index": "43/03"}],
    "zivildienst": [{"Index": "44/01"}],
    "voelkerrecht": [{"Index": "19/01"}, {"Index": "19/02"}, {"Index": "19/03"}, {"Index": "19/04"}],
    # 2: Zivil- und Strafrecht (20-29)
    "zivilrecht": [{"Index": "20/01"}],
    "handelsrecht": [{"Index": "21/01"}],
    "aktienrecht": [{"Index": "21/02"}],
    "gmbh_recht": [{"Index": "21/03"}],
    "genossenschaftsrecht": [{"Index": "21/04"}],
    "wertpapierrecht": [{"Index": "21/05"}, {"Index": "21/06"}],
    "versicherungsrecht": [{"Index": "57/01"}],
    "zivilprozess": [{"Index": "22/01"}, {"Index": "22/02"}],
    "ausserstreit": [{"Index": "22/03"}],
    "exekutionsrecht": [{"Index": "23/04"}],
    "insolvenzrecht": [{"Index": "23/01"}],
    "justizverwaltung": [{"Index": "27/01"}, {"Index": "27/02"}],
    "notariat": [{"Index": "27/03"}],
    "urheberrecht": [{"Index": "20/08"}],
    "patentrecht": [{"Index": "26/02"}, {"Index": "26/03"}],
    # 3: Finanzrecht (30-39)
    "finanzrecht_allg": [{"Index": "30/01"}, {"Index": "31/01"}],
    "abgabenrecht": [{"Index": "32/01"}],
    "einkommensteuer": [{"Index": "32/02"}],
    "koerperschaftsteuer": [{"Index": "32/02"}],
    "umsatzsteuer": [{"Index": "32/04"}],
    "gebuehrenrecht": [{"Index": "32/06"}, {"Index": "32/07"}],
    "bewertungsrecht": [{"Index": "32/03"}],
    "zollrecht": [{"Index": "35/01"}, {"Index": "35/02"}],
    "finanzausgleich": [{"Index": "30/01"}],
    "finanzstrafrecht": [{"Index": "32/01"}],
    # 4: Innere Verwaltung (40-49)
    "verwaltungsverfahren": [{"Index": "40/01"}, {"Index": "40/02"}, {"Index": "40/03"}],
    "staatsbuergerschaft": [{"Index": "41/02"}],
    "personenstandsrecht": [{"Index": "41/01"}],
    "sicherheitspolizei": [{"Index": "41/03"}],
    "fremdenrecht": [{"Index": "41/02"}],
    "waffenrecht": [{"Index": "41/04"}],
    "vereinsrecht": [{"Index": "41/01"}],
    "datenschutz": [{"Index": "10/10"}],
    # 5: Wirtschaft (50-59)
    "gewerberecht": [{"Index": "50/01"}, {"Index": "50/02"}, {"Index": "50/03"}],
    "bergrecht": [{"Index": "58/01"}],
    "energierecht": [{"Index": "58/02"}],
    "preisrecht": [{"Index": "26/01"}],
    "vergaberecht": [{"Index": "55/01"}],
    "bankrecht": [{"Index": "37/02"}],
    # 9: Verkehr/Technik (90-99)
    "verkehrsrecht": [{"Index": "90/01"}, {"Index": "90/02"}],
    "schifffahrt": [{"Index": "94/01"}],
    "luftfahrt": [{"Index": "92/01"}],
    "eisenbahn": [{"Index": "93/01"}],
    "telekommunikation": [{"Index": "91/01"}],
    "postrecht": [{"Index": "91/02"}],
    # 6: Arbeitsrecht, Dienstrecht, Sozialrecht (60-69)
    "arbeitsrecht": [{"Index": "60/01"}, {"Index": "60/02"}, {"Index": "60/03"}, {"Index": "60/04"}, {"Index": "60/05"}],
    "arbeitsschutz": [{"Index": "60/02"}],
    "arbeitsmarkt": [{"Index": "62/01"}],
    "beamtendienstrecht": [{"Index": "63/01"}, {"Index": "63/02"}],
    "personalvertretung": [{"Index": "63/07"}],
    "sozialversicherung": [{"Index": "66/01"}],
    "pensionsrecht": [{"Index": "65/01"}],
    "pflegegeld": [{"Index": "68/01"}],
    "sozialhilfe": [{"Index": "67/01"}],
    # 7: Schulen, Wissenschaft, Kultur (70-79)
    "schulrecht": [{"Index": "70/01"}, {"Index": "70/02"}, {"Index": "70/03"}, {"Index": "70/04"}],
    "hochschulrecht": [{"Index": "72/01"}, {"Index": "72/02"}, {"Index": "72/03"}],
    "forschung": [{"Index": "72/01"}],
    "kulturrecht": [{"Index": "77/01"}, {"Index": "77/02"}],
    "medienfoerderung": [{"Index": "77/01"}],
    "sportrecht": [{"Index": "78/01"}],
    # 8: Land-/Forstwirtschaft, Gesundheit, Umwelt (80-89)
    "landwirtschaft": [{"Index": "80/01"}, {"Index": "80/02"}, {"Index": "80/03"}],
    "tierschutz": [{"Index": "86/01"}],
    "wasserrecht": [{"Index": "81/01"}],
    "gesundheitsrecht": [{"Index": "82/03"}, {"Index": "82/06"}],
    "arzneimittelrecht": [{"Index": "82/04"}],
    "lebensmittelrecht": [{"Index": "82/05"}],
    "umweltrecht": [{"Index": "83/01"}, {"Index": "83/02"}, {"Index": "83/03"}],
    "abfallrecht": [{"Index": "83/03"}],
    "chemikalienrecht": [{"Index": "83/04"}],
    # Strafrecht (24/25)
    "strafrecht": [{"Index": "24/01"}],
    "nebenstrafrecht": [{"Index": "24/01"}],
    "strafprozess": [{"Index": "25/01"}],
    "strafvollzug": [{"Index": "25/02"}, {"Index": "24/02"}],
    "opferschutz": [{"Index": "25/02"}],
    # Sonderquellen
    "unionsrecht": [],
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
    {"applikation": "Justiz", "label": "Ordentliche Gerichte"},
    {"applikation": "Vfgh", "label": "Verfassungsgerichtshof"},
    {"applikation": "Vwgh", "label": "Verwaltungsgerichtshof"},
    {"applikation": "Bvwg", "label": "Bundesverwaltungsgericht"},
    {"applikation": "Lvwg", "label": "Landesverwaltungsgerichte"},
]

# Map Rechtsgebiet → relevant court Applikation(en) for Judikatur.
# Unmapped categories → query all courts with Suchworte.
CATEGORY_TO_COURTS: dict[str, list[str]] = {
    # VfGH
    "verfassungsrecht": ["Vfgh"], "grundrechte": ["Vfgh"], "wahlen": ["Vfgh"],
    "verfassungsgerichtsbarkeit": ["Vfgh"], "eu_integration": ["Vfgh"],
    # VwGH + BVwG + LVwG
    "verwaltungsverfahren": ["Vwgh", "Bvwg", "Lvwg"],
    "sicherheitspolizei": ["Vwgh", "Bvwg"], "fremdenrecht": ["Vwgh", "Bvwg"],
    "staatsbuergerschaft": ["Vwgh", "Bvwg"], "waffenrecht": ["Vwgh", "Bvwg"],
    "datenschutz": ["Vwgh", "Bvwg"], "vereinsrecht": ["Vwgh", "Bvwg"],
    "beamtendienstrecht": ["Vwgh", "Bvwg"], "personalvertretung": ["Vwgh", "Bvwg"],
    "finanzrecht_allg": ["Vwgh", "Bvwg"], "abgabenrecht": ["Vwgh", "Bvwg"],
    "einkommensteuer": ["Vwgh", "Bvwg"], "koerperschaftsteuer": ["Vwgh", "Bvwg"],
    "umsatzsteuer": ["Vwgh", "Bvwg"], "gebuehrenrecht": ["Vwgh", "Bvwg"],
    "bewertungsrecht": ["Vwgh", "Bvwg"], "zollrecht": ["Vwgh", "Bvwg"],
    "finanzausgleich": ["Vwgh", "Bvwg"], "finanzstrafrecht": ["Vwgh", "Bvwg"],
    "gewerberecht": ["Vwgh", "Bvwg", "Lvwg"], "bergrecht": ["Vwgh", "Bvwg"],
    "energierecht": ["Vwgh", "Bvwg"], "verkehrsrecht": ["Vwgh", "Bvwg", "Lvwg"],
    "telekommunikation": ["Vwgh", "Bvwg"],
    "gesundheitsrecht": ["Vwgh", "Bvwg"], "umweltrecht": ["Vwgh", "Bvwg", "Lvwg"],
    "wasserrecht": ["Vwgh", "Bvwg", "Lvwg"], "landwirtschaft": ["Vwgh", "Bvwg"],
    "sozialversicherung": ["Vwgh", "Bvwg"], "pflegegeld": ["Vwgh", "Bvwg"],
    # Ordentliche Gerichte
    "zivilrecht": ["Justiz"], "handelsrecht": ["Justiz"],
    "aktienrecht": ["Justiz"], "gmbh_recht": ["Justiz"],
    "genossenschaftsrecht": ["Justiz"], "wertpapierrecht": ["Justiz"],
    "versicherungsrecht": ["Justiz"], "bankrecht": ["Justiz"],
    "zivilprozess": ["Justiz"], "ausserstreit": ["Justiz"],
    "exekutionsrecht": ["Justiz"], "insolvenzrecht": ["Justiz"],
    "urheberrecht": ["Justiz"], "patentrecht": ["Justiz"], "preisrecht": ["Justiz"],
    "strafrecht": ["Justiz"], "nebenstrafrecht": ["Justiz"],
    "strafprozess": ["Justiz"], "strafvollzug": ["Justiz"], "opferschutz": ["Justiz"],
    "arbeitsrecht": ["Justiz"], "arbeitsschutz": ["Justiz"],
    # VfGH + VwGH
    "aeusseres": ["Vfgh", "Vwgh"], "landesverteidigung": ["Vwgh", "Bvwg"],
}

# DokumenteProSeite enum
DOCS_PER_PAGE = "Twenty"


# ── API Calls ──

async def search_gesetze(
    category: str,
    im_ris_seit: str,
    page: int = 1,
    datum_von: str = "",
    datum_bis: str = "",
) -> dict:
    """Search Bundesrecht using RIS Index + ImRisSeit or date range.

    Strategy:
    1. Try Index parameter (official legal classification) + ImRisSeit
    2. If 0 hits, fallback to Suchworte (category label) + ImRisSeit
    3. No category → unfiltered ImRisSeit search
    """
    searches = _CATEGORY_SEARCH.get(category, []) if category else []

    if searches:
        return await _search_by_params(searches, im_ris_seit, page, datum_von, datum_bis)
    else:
        # No category selected or unknown → broad search
        params: dict = {
            "Applikation": "BrKons",
            "DokumenteProSeite": DOCS_PER_PAGE,
            "Seitennummer": page,
        }
        if datum_von and datum_bis:
            params["Fassung.VonInkrafttretensdatum"] = datum_von
            params["Fassung.BisInkrafttretensdatum"] = datum_bis
        else:
            params["ImRisSeit"] = im_ris_seit
        url = f"{settings.RIS_API_BASE_URL}/Bundesrecht"
        return await _fetch(url, params)


async def _search_by_params(
    searches: list[dict],
    im_ris_seit: str,
    page: int,
    datum_von: str = "",
    datum_bis: str = "",
) -> dict:
    """Query RIS with multiple Index param sets in parallel, combine results.

    Each search dict has {"Index": "XX/YY"} — filtering exclusively by Index.
    """

    # Compute date range for Fassung filter (custom dates override)
    if datum_von and datum_bis:
        von = datum_von
        bis = datum_bis
    else:
        days = _timeframe_to_days(im_ris_seit)
        today = date.today()
        von = (today - timedelta(days=days)).strftime("%Y-%m-%d")
        bis = today.strftime("%Y-%m-%d")

    async def _query_one(search_params: dict) -> dict:
        url = f"{settings.RIS_API_BASE_URL}/Bundesrecht"

        # Try 1: Index + Fassung.VonInkrafttretensdatum (most precise)
        params = {
            "Applikation": "BrKons",
            "Fassung.VonInkrafttretensdatum": von,
            "Fassung.BisInkrafttretensdatum": bis,
            "DokumenteProSeite": "OneHundred",
            "Seitennummer": page,
        }
        params.update(search_params)
        result = await _fetch(url, params)
        hits = _extract_hits(result)
        label = "&".join(f"{k}={v}" for k, v in search_params.items())
        logger.info(f"Search {label} +Fassung: {hits} hits")

        if hits > 0:
            return result

        # Try 2: Index + ImRisSeit (fallback if Fassung combo fails)
        params2 = {
            "Applikation": "BrKons",
            "ImRisSeit": im_ris_seit,
            "DokumenteProSeite": "OneHundred",
            "Seitennummer": page,
        }
        params2.update(search_params)
        result2 = await _fetch(url, params2)
        hits2 = _extract_hits(result2)
        logger.info(f"Search {label} +ImRisSeit fallback: {hits2} hits")
        return result2

    raw_results = await asyncio.gather(*[_query_one(s) for s in searches])

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


async def search_begutachtung(
    suchworte: str = "",
    im_ris_seit: str = "EinemJahr",
    page: int = 1,
) -> list[dict]:
    """Search Begutachtungsentwürfe (draft legislation for review)."""
    params: dict = {
        "Applikation": "Begut",
        "DokumenteProSeite": "Twenty",
        "Seitennummer": page,
    }
    if suchworte:
        params["Suchworte"] = suchworte
    if im_ris_seit:
        params["ImRisSeit"] = im_ris_seit

    url = f"{settings.RIS_API_BASE_URL}/Bundesrecht"
    data = await _fetch(url, params)
    return _parse_parliamentary(data, "Begutachtungsentwurf")


async def search_regierungsvorlagen(
    suchworte: str = "",
    im_ris_seit: str = "EinemJahr",
    page: int = 1,
) -> list[dict]:
    """Search Regierungsvorlagen (government bills)."""
    params: dict = {
        "Applikation": "RegV",
        "DokumenteProSeite": "Twenty",
        "Seitennummer": page,
    }
    if suchworte:
        params["Suchworte"] = suchworte
    if im_ris_seit:
        params["ImRisSeit"] = im_ris_seit

    url = f"{settings.RIS_API_BASE_URL}/Bundesrecht"
    data = await _fetch(url, params)
    return _parse_parliamentary(data, "Regierungsvorlage")


def _parse_parliamentary(data: dict, doc_type_label: str) -> list[dict]:
    """Parse Begut/RegV API response."""
    refs = _extract_refs(data)
    results = []
    for ref in refs:
        d = ref.get("Data", {})
        m = _collect_metadata(d.get("Metadaten", {}), ["Technisch", "Allgemein", "Bundesrecht", "BrKons", "Begut", "RegV"])

        doc_id = _s(m.get("ID")) or _s(m.get("Dokumentnummer")) or ""
        title = _s(m.get("Kurztitel")) or _s(m.get("Langtitel")) or doc_id
        url = _s(m.get("DokumentUrl")) or ""
        bgbl = _s(m.get("Kundmachungsorgan")) or ""
        stelle = _s(m.get("EinbringendeStelle")) or ""

        if not doc_id:
            continue

        results.append({
            "id": doc_id,
            "title": title,
            "url": url,
            "bgbl": bgbl,
            "stelle": stelle,
            "typ": doc_type_label,
        })
    return results


async def search_gerichtsentscheidungen(
    category: str,
    im_ris_seit: str,
    page: int = 1,
) -> dict:
    """Search Judikatur (Gerichtsentscheidungen).

    Uses: /Judikatur?Applikation=...&EntscheidungsdatumVon=...
    Strategy:
      - Map Rechtsgebiet to specific courts (Justiz, Vfgh, Vwgh, etc.)
      - Filter by EntscheidungsdatumVon (date range)
      - For specific categories, add Suchworte to narrow results
      - If no category → query all courts unfiltered
    All court queries run in parallel.
    """
    days = _timeframe_to_days(im_ris_seit)
    date_from = (date.today() - timedelta(days=days)).strftime("%Y-%m-%d")

    courts = CATEGORY_TO_COURTS.get(category, [c["applikation"] for c in COURT_SOURCES])

    # Filter by NORM (law name) — the Judikatur API supports a "Norm" parameter
    # that filters by the law applied in the decision.
    _CATEGORY_NORMEN: dict[str, str] = {
        "verfassungsrecht": "B-VG", "grundrechte": "EMRK", "wahlen": "NRWO",
        "amtshaftung": "AHG", "eu_integration": "EU",
        "verwaltungsverfahren": "AVG", "sicherheitspolizei": "SPG",
        "staatsbuergerschaft": "StbG", "fremdenrecht": "FPG",
        "waffenrecht": "WaffG", "datenschutz": "DSG",
        "beamtendienstrecht": "BDG",
        "zivilrecht": "ABGB", "handelsrecht": "UGB",
        "aktienrecht": "AktG", "gmbh_recht": "GmbHG",
        "genossenschaftsrecht": "GenG", "wertpapierrecht": "BörseG",
        "versicherungsrecht": "VersVG", "bankrecht": "BWG",
        "urheberrecht": "UrhG", "patentrecht": "PatG",
        "zivilprozess": "ZPO", "ausserstreit": "AußStrG",
        "exekutionsrecht": "EO", "insolvenzrecht": "IO",
        "strafrecht": "StGB", "nebenstrafrecht": "SMG",
        "strafprozess": "StPO", "strafvollzug": "StVG",
        "finanzrecht_allg": "FinStrG", "abgabenrecht": "BAO",
        "einkommensteuer": "EStG", "koerperschaftsteuer": "KStG",
        "umsatzsteuer": "UStG", "zollrecht": "ZollG",
        "finanzstrafrecht": "FinStrG",
        "arbeitsrecht": "ArbVG", "arbeitsschutz": "ASchG",
        "sozialversicherung": "ASVG", "pensionsrecht": "PG",
        "gewerberecht": "GewO", "energierecht": "ElWOG",
        "preisrecht": "UWG", "verkehrsrecht": "StVO",
        "telekommunikation": "TKG",
        "schulrecht": "SchUG", "hochschulrecht": "UG",
        "gesundheitsrecht": "ÄrzteG", "arzneimittelrecht": "AMG",
        "lebensmittelrecht": "LMSVG",
        "umweltrecht": "UVP-G", "wasserrecht": "WRG",
        "landwirtschaft": "ForstG", "tierschutz": "TSchG",
    }
    norm = _CATEGORY_NORMEN.get(category, "")

    async def _query_court(court: str) -> tuple[list[dict], int]:
        params: dict = {
            "Applikation": court,
            "DokumenteProSeite": DOCS_PER_PAGE,
            "Seitennummer": page,
            "EntscheidungsdatumVon": date_from,
        }
        if norm:
            params["Norm"] = norm

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


def parse_bundesrecht_response(data: dict, timeframe_days: int = 366) -> dict:
    """Parse Bundesrecht API response into a list of result dicts.

    Filters to only include provisions with Inkrafttretensdatum within
    the search timeframe. This eliminates metadata-only updates.
    """
    refs = _extract_refs(data)
    total_hits = _extract_hits(data)
    results = []
    inkraft_cutoff = (date.today() - timedelta(days=timeframe_days)).strftime("%Y-%m-%d")

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
        bgbl = _s(m.get("Kundmachungsorgan")) or ""
        # Aenderung contains the Novellen-BGBl (e.g. "BGBl. I Nr. 97/2025")
        # This is the BGBl of the amendment, not the original law
        aenderung = _s(m.get("Aenderung")) or ""
        if aenderung and not bgbl:
            bgbl = aenderung
        elif aenderung and bgbl and aenderung != bgbl:
            # Combine: show Stammgesetz BGBl + "zuletzt geändert durch" Novellen-BGBl
            bgbl = f"{bgbl} zuletzt geändert durch {aenderung}"
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
        # Gesetzesmaterialien: "NR: GP XXVIII RV 301 AB 389 S. 52."
        materialien_str = _s(m.get("Gesetzesmaterialien")) or _s(m.get("Materialien")) or ""

        # Skip provisions superseded before taking effect (Ausserkraft < Inkraft)
        if ausserkraft and change_date and _date_before(ausserkraft, change_date):
            continue

        # Skip provisions where Inkrafttretensdatum is BEFORE the search timeframe.
        # This filters out metadata-only updates (ImRisSeit catches them but
        # their Inkrafttreten is years old).
        if change_date and change_date < inkraft_cutoff:
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
            "materialien": materialien_str,
            "aenderung_bgbl": aenderung,
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

    # Case number: take only the FIRST one (API sometimes returns comma-separated lists)
    raw_gz = _s(m.get("Geschaeftszahl")) or _s(data_entry.get("Geschaeftszahl")) or ""
    case_number = raw_gz.split(",")[0].strip() if raw_gz else ""

    court_name = _s(m.get("Gericht")) or _s(data_entry.get("Gericht")) or court_app
    decision_date = _s(m.get("Entscheidungsdatum")) or _s(data_entry.get("Entscheidungsdatum")) or ""

    # Title: prefer Betreff (subject), then Kurztitel, fallback to court + case number
    betreff = _s(m.get("Betreff")) or ""
    kurztitel = _s(m.get("Kurztitel")) or ""
    title = betreff or kurztitel or f"{court_name} {case_number}"
    if len(title) > 200:
        title = title[:197] + "..."

    doc_url = _extract_doc_url(m, ref, data_entry)
    normen = _s(m.get("Norm")) or ""
    if len(normen) > 300:
        normen = normen[:297] + "..."

    # Rechtssatz (legal principle) — full text, no truncation
    rechtssatz = _s(m.get("Rechtssatz")) or _s(m.get("RechtssatzKurz")) or ""

    # Try to extract full document content (Entscheidungstext)
    # The API rarely includes text inline — usually it's in ContentUrl
    entscheidungstext = ""
    for key in ("Dokumentinhalt", "DokumentInhalt"):
        content = data_entry.get(key, "")
        if isinstance(content, str) and len(content) > 50:
            entscheidungstext = _strip_html_simple(content)
            break

    # Extract ContentUrl for later fetching (text usually lives here)
    content_url = _find_judikatur_content_url(data_entry)

    doc_typ = _s(m.get("Dokumenttyp")) or _s(m.get("DokumentTyp")) or ""

    # Log what we got for debugging
    logger.info(
        f"Judikatur doc {doc_id}: typ={doc_typ}, court={court_name}, "
        f"rs_len={len(rechtssatz)}, et_len={len(entscheidungstext)}, "
        f"content_url={'yes' if content_url else 'no'}, "
        f"data_keys={list(data_entry.keys())[:10]}"
    )

    return {
        "id": doc_id,
        "title": title,
        "url": doc_url,
        "date": decision_date,
        "case_number": case_number,
        "court": court_name,
        "normen": normen,
        "rechtssatz": rechtssatz,
        "entscheidungstext": entscheidungstext,
        "content_url": content_url,
        "doc_typ": doc_typ,
    }


async def fetch_judikatur_texts(results: list[dict], max_results: int = 15) -> dict[str, str]:
    """Fetch full decision texts for Judikatur results.

    Strategy (in order):
    1. Re-query RIS Judikatur API by Dokumentnummer (try matching Applikation)
    2. Fetch document URL directly from RIS website and extract text
    3. Build Dokument.wxe URL from doc ID as fallback

    Returns: {doc_id: text_content} for results where text was found.
    """
    import re

    texts: dict[str, str] = {}
    # Only fetch court decision results (have court or case_number)
    to_fetch = [r for r in results[:max_results]
                if r.get("id") and (r.get("court") or r.get("case_number"))]

    if not to_fetch:
        return texts

    _HEADERS = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    }

    # Map court names to Applikation values
    _COURT_TO_APP = {
        "OGH": "Justiz", "OLG": "Justiz", "LG": "Justiz", "BG": "Justiz",
        "VfGH": "Vfgh", "VwGH": "Vwgh", "BVwG": "Bvwg", "LVwG": "Lvwg",
    }

    def _guess_applikation(r: dict) -> list[str]:
        """Guess Applikation from court name."""
        court = r.get("court", "")
        for prefix, app in _COURT_TO_APP.items():
            if prefix.lower() in court.lower():
                return [app]
        # Default: try all
        return ["Justiz", "Vfgh", "Vwgh", "Bvwg"]

    async def _fetch_one(r: dict) -> tuple[str, str]:
        doc_id = r["id"]
        logger.info(f"Fetching Judikatur text for {doc_id} (court={r.get('court','')}, content_url={'yes' if r.get('content_url') else 'no'})")

        async with httpx.AsyncClient(timeout=25.0, follow_redirects=True, headers=_HEADERS) as client:
            # Strategy 0: Use ContentUrl from search results (fastest — no re-query)
            content_url = r.get("content_url", "")
            if content_url:
                try:
                    resp = await client.get(content_url, timeout=15.0)
                    resp.raise_for_status()
                    text = _strip_html_simple(resp.text)
                    if len(text) > 50:
                        logger.info(f"Got text via search content_url for {doc_id}: {len(text)} chars")
                        return doc_id, text
                except Exception as e:
                    logger.warning(f"ContentUrl fetch error {doc_id}: {e}")

            # Strategy 1: Re-query API with correct Applikation
            apps = _guess_applikation(r)
            for app in apps:
                try:
                    params = {
                        "Applikation": app,
                        "Dokumentnummer": doc_id,
                        "DokumenteProSeite": "One",
                    }
                    api_url = f"{settings.RIS_API_BASE_URL}/Judikatur"
                    resp = await client.get(api_url, params=params)
                    resp.raise_for_status()
                    data = resp.json()

                    refs = _extract_refs(data)
                    if not refs:
                        continue

                    d = refs[0].get("Data", {})

                    # Try inline Dokumentinhalt
                    for key in ("Dokumentinhalt", "DokumentInhalt"):
                        content = d.get(key, "")
                        if isinstance(content, str) and len(content) > 50:
                            text = _strip_html_simple(content)
                            if len(text) > 50:
                                logger.info(f"Got inline text for {doc_id} via {app}: {len(text)} chars")
                                return doc_id, text

                    # Try ContentUrl (MainDocument)
                    main_url = _find_judikatur_content_url(d)
                    if main_url:
                        try:
                            r2 = await client.get(main_url, timeout=15.0)
                            r2.raise_for_status()
                            text = _strip_html_simple(r2.text)
                            if len(text) > 50:
                                logger.info(f"Got ContentUrl text for {doc_id}: {len(text)} chars")
                                return doc_id, text
                        except Exception as e:
                            logger.warning(f"ContentUrl fetch error {doc_id}: {e}")

                except Exception as e:
                    logger.warning(f"API query error {doc_id} app={app}: {e}")

            # Strategy 2: Fetch the document URL directly (from search results)
            doc_url = r.get("url", "")
            if doc_url and "ris.bka.gv.at" in doc_url:
                try:
                    r3 = await client.get(doc_url, timeout=15.0)
                    r3.raise_for_status()
                    text = _extract_judikatur_page_text(r3.text)
                    if text and len(text) > 50:
                        logger.info(f"Got page text for {doc_id} from URL: {len(text)} chars")
                        return doc_id, text
                except Exception as e:
                    logger.warning(f"URL fetch error {doc_id}: {e}")

            # Strategy 3: Build Dokument.wxe URL
            if doc_id and not doc_id.startswith("NOR"):
                try:
                    wxe_url = f"https://www.ris.bka.gv.at/Dokument.wxe?Abfrage=Justiz&Dokumentnummer={doc_id}"
                    r4 = await client.get(wxe_url, timeout=15.0)
                    r4.raise_for_status()
                    text = _extract_judikatur_page_text(r4.text)
                    if text and len(text) > 50:
                        logger.info(f"Got Dokument.wxe text for {doc_id}: {len(text)} chars")
                        return doc_id, text
                except Exception as e:
                    logger.warning(f"Dokument.wxe error {doc_id}: {e}")

        return doc_id, ""

    # Fetch sequentially to avoid RIS throttling
    for r in to_fetch:
        doc_id, text = await _fetch_one(r)
        if text:
            texts[doc_id] = text[:3000]
        await asyncio.sleep(0.3)

    logger.info(f"Fetched {len(texts)}/{len(to_fetch)} Judikatur texts")
    return texts


def _extract_judikatur_page_text(html: str) -> str:
    """Extract decision text from a RIS Judikatur HTML page.

    Looks for sections like Entscheidungstext, Rechtssatz, Spruch, Begründung.
    """
    import re

    # Try to find the main content section
    # RIS pages have sections: Kopf, Spruch, Text (Begründung), Schlagworte
    patterns = [
        # Entscheidungstext section (most common)
        r'(?:>)\s*(?:Text|Begründung|Entscheidungsgründe)\s*(?:</[^>]+>)(.*?)(?:<div\s+class="(?:doc|abs)"|Schlagworte|Dokumentnummer|European\s+Legislation|Zuletzt\s+aktualisiert)',
        # Spruch + Text together
        r'(?:>)\s*Spruch\s*(?:</[^>]+>)(.*?)(?:Schlagworte|Dokumentnummer|European\s+Legislation)',
        # Broad: anything after "Kopf" section
        r'(?:>)\s*Kopf\s*(?:</[^>]+>)(.*?)(?:Schlagworte|Dokumentnummer|European\s+Legislation)',
        # Just look for the main content div
        r'<div[^>]*class="[^"]*doc[^"]*"[^>]*>(.*?)</div>\s*(?:<div\s+class="[^"]*(?:schlagwort|footnote)',
    ]

    for pat in patterns:
        m = re.search(pat, html, re.DOTALL | re.IGNORECASE)
        if m:
            text = _strip_html_simple(m.group(1))
            if len(text) > 100:
                return text

    # Last resort: strip everything and take the middle section
    full_text = _strip_html_simple(html)
    if len(full_text) > 500:
        # Skip header (first ~20%) and footer (last ~10%)
        start = len(full_text) // 5
        end = len(full_text) * 9 // 10
        return full_text[start:end]

    return ""


def _find_judikatur_content_url(data_entry: dict) -> str:
    """Find the MainDocument content URL in a Judikatur API response."""
    url = ""

    def _search(obj, depth=0):
        nonlocal url
        if depth > 12 or url:
            return
        if isinstance(obj, dict):
            ct = obj.get("ContentType", "")
            cu = obj.get("ContentUrl")
            candidate = ""
            if isinstance(cu, str) and cu.startswith("http"):
                candidate = cu
            elif isinstance(cu, dict) and "Url" in cu:
                candidate = cu["Url"]
            elif isinstance(cu, list):
                for item in cu:
                    if isinstance(item, dict) and "Url" in item:
                        candidate = item["Url"]
                        break
                    elif isinstance(item, str) and item.startswith("http"):
                        candidate = item
                        break
            if candidate and (ct == "MainDocument" or obj.get("DataType") == "Xml"):
                url = candidate
                return
            for val in obj.values():
                _search(val, depth + 1)
        elif isinstance(obj, list):
            for item in obj:
                _search(item, depth + 1)

    _search(data_entry)
    return url


def _strip_html_simple(html: str) -> str:
    """Strip HTML tags and clean up whitespace."""
    import re
    text = re.sub(r'<br\s*/?\s*>', '\n', html, flags=re.IGNORECASE)
    text = re.sub(r'<[^>]+>', ' ', text)
    text = re.sub(r'&nbsp;', ' ', text)
    text = re.sub(r'&amp;', '&', text)
    text = re.sub(r'&lt;', '<', text)
    text = re.sub(r'&gt;', '>', text)
    text = re.sub(r'&quot;', '"', text)
    text = re.sub(r'&#\d+;', '', text)
    text = re.sub(r'[ \t]+', ' ', text)
    text = re.sub(r'\n\s*\n+', '\n\n', text)
    return text.strip()
