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
    {"id": "voelkerrecht", "label": "Völkerrechtliche Verträge (Verfassung)", "group": "Äußeres & Verteidigung"},
    # ── 2: Privatrecht ──
    {"id": "zivilrecht", "label": "Bürgerliches Recht (ABGB)", "group": "Privatrecht"},
    {"id": "handelsrecht", "label": "Handelsrecht / Unternehmensrecht (UGB)", "group": "Privatrecht"},
    {"id": "aktienrecht", "label": "Aktienrecht", "group": "Privatrecht"},
    {"id": "gmbh_recht", "label": "GmbH-Recht", "group": "Privatrecht"},
    {"id": "genossenschaftsrecht", "label": "Genossenschaftsrecht", "group": "Privatrecht"},
    {"id": "wertpapierrecht", "label": "Wertpapierrecht / Börserecht", "group": "Privatrecht"},
    {"id": "versicherungsrecht", "label": "Versicherungsrecht", "group": "Privatrecht"},
    {"id": "zivilprozess", "label": "Zivilprozessrecht (ZPO)", "group": "Verfahrensrecht"},
    {"id": "ausserstreit", "label": "Außerstreitverfahren", "group": "Verfahrensrecht"},
    {"id": "exekutionsrecht", "label": "Exekutionsrecht", "group": "Verfahrensrecht"},
    {"id": "insolvenzrecht", "label": "Insolvenzrecht", "group": "Verfahrensrecht"},
    {"id": "justizverwaltung", "label": "Justizverwaltung", "group": "Verfahrensrecht"},
    {"id": "notariat", "label": "Notariatswesen", "group": "Verfahrensrecht"},
    {"id": "urheberrecht", "label": "Urheberrecht", "group": "Gewerblicher Rechtsschutz"},
    {"id": "patentrecht", "label": "Patentrecht / Markenrecht / Musterschutz", "group": "Gewerblicher Rechtsschutz"},
    # ── 3: Finanzrecht ──
    {"id": "finanzrecht_allg", "label": "Finanzrecht allgemein / Haushaltsrecht", "group": "Finanzrecht"},
    {"id": "abgabenrecht", "label": "Abgabenverfahrensrecht (BAO)", "group": "Finanzrecht"},
    {"id": "einkommensteuer", "label": "Einkommensteuer / Lohnsteuer (EStG)", "group": "Steuerrecht"},
    {"id": "koerperschaftsteuer", "label": "Körperschaftsteuer (KStG)", "group": "Steuerrecht"},
    {"id": "umsatzsteuer", "label": "Umsatzsteuer (UStG)", "group": "Steuerrecht"},
    {"id": "gebuehrenrecht", "label": "Gebührenrecht / Verkehrsteuern", "group": "Steuerrecht"},
    {"id": "bewertungsrecht", "label": "Bewertungsrecht", "group": "Steuerrecht"},
    {"id": "zollrecht", "label": "Zollrecht", "group": "Steuerrecht"},
    {"id": "finanzausgleich", "label": "Finanzausgleich", "group": "Steuerrecht"},
    {"id": "finanzstrafrecht", "label": "Finanzstrafrecht (FinStrG)", "group": "Steuerrecht"},
    # ── 4: Innere Verwaltung ──
    {"id": "verwaltungsverfahren", "label": "Verwaltungsverfahren (AVG / VwGVG)", "group": "Verwaltungsrecht"},
    {"id": "staatsbuergerschaft", "label": "Staatsbürgerschaft / Pass- / Meldewesen", "group": "Verwaltungsrecht"},
    {"id": "personenstandsrecht", "label": "Personenstandsrecht", "group": "Verwaltungsrecht"},
    {"id": "sicherheitspolizei", "label": "Sicherheitspolizei (SPG)", "group": "Verwaltungsrecht"},
    {"id": "fremdenrecht", "label": "Fremden- und Asylrecht (FPG / AsylG)", "group": "Verwaltungsrecht"},
    {"id": "waffenrecht", "label": "Waffenrecht", "group": "Verwaltungsrecht"},
    {"id": "vereinsrecht", "label": "Vereins- und Versammlungsrecht", "group": "Verwaltungsrecht"},
    {"id": "datenschutz", "label": "Datenschutz (DSG / DSGVO)", "group": "Verwaltungsrecht"},
    # ── 5: Gewerbe, Industrie, Handel, Verkehr ──
    {"id": "gewerberecht", "label": "Gewerberecht (GewO)", "group": "Wirtschaftsrecht"},
    {"id": "bergrecht", "label": "Bergrecht", "group": "Wirtschaftsrecht"},
    {"id": "energierecht", "label": "Energierecht", "group": "Wirtschaftsrecht"},
    {"id": "preisrecht", "label": "Preisrecht / Wettbewerbsrecht (UWG / KartG)", "group": "Wirtschaftsrecht"},
    {"id": "bankrecht", "label": "Bank- und Kapitalmarktrecht (BWG / WAG)", "group": "Wirtschaftsrecht"},
    {"id": "verkehrsrecht", "label": "Verkehrsrecht (StVO / KFG / FSG)", "group": "Wirtschaftsrecht"},
    {"id": "schifffahrt", "label": "Schifffahrtsrecht", "group": "Wirtschaftsrecht"},
    {"id": "luftfahrt", "label": "Luftfahrtrecht", "group": "Wirtschaftsrecht"},
    {"id": "eisenbahn", "label": "Eisenbahnrecht", "group": "Wirtschaftsrecht"},
    {"id": "telekommunikation", "label": "Telekommunikation / Medien (TKG / MedienG)", "group": "Wirtschaftsrecht"},
    {"id": "postrecht", "label": "Postrecht", "group": "Wirtschaftsrecht"},
    # ── 6: Arbeitsrecht, Dienstrecht, Sozialrecht ──
    {"id": "arbeitsrecht", "label": "Arbeitsrecht (ArbVG / AZG / UrlG)", "group": "Arbeits- & Sozialrecht"},
    {"id": "arbeitsschutz", "label": "ArbeitnehmerInnenschutz (ASchG)", "group": "Arbeits- & Sozialrecht"},
    {"id": "arbeitsmarkt", "label": "Arbeitsmarktrecht / Arbeitslosenversicherung", "group": "Arbeits- & Sozialrecht"},
    {"id": "beamtendienstrecht", "label": "Beamtendienstrecht (BDG / GehG)", "group": "Arbeits- & Sozialrecht"},
    {"id": "personalvertretung", "label": "Personalvertretungsrecht", "group": "Arbeits- & Sozialrecht"},
    {"id": "sozialversicherung", "label": "Sozialversicherungsrecht (ASVG)", "group": "Arbeits- & Sozialrecht"},
    {"id": "pensionsrecht", "label": "Pensionsrecht", "group": "Arbeits- & Sozialrecht"},
    {"id": "pflegegeld", "label": "Pflegegeld / Behindertenrecht", "group": "Arbeits- & Sozialrecht"},
    {"id": "sozialhilfe", "label": "Sozialhilfe / Grundversorgung", "group": "Arbeits- & Sozialrecht"},
    # ── 7: Unterricht, Wissenschaft, Kultur ──
    {"id": "schulrecht", "label": "Schulrecht (SchUG / SchOG)", "group": "Bildung & Kultur"},
    {"id": "hochschulrecht", "label": "Hochschulrecht (UG / FHG)", "group": "Bildung & Kultur"},
    {"id": "forschung", "label": "Forschung / Wissenschaft (FOG)", "group": "Bildung & Kultur"},
    {"id": "kulturrecht", "label": "Kunst / Kultur / Denkmalschutz", "group": "Bildung & Kultur"},
    {"id": "medienfoerderung", "label": "Medienförderung / Pressewesen", "group": "Bildung & Kultur"},
    {"id": "sportrecht", "label": "Sportrecht", "group": "Bildung & Kultur"},
    # ── 8: Land-/Forstwirtschaft, Gesundheit, Umwelt ──
    {"id": "landwirtschaft", "label": "Land- und Forstwirtschaft", "group": "Gesundheit & Umwelt"},
    {"id": "tierschutz", "label": "Tierschutz / Veterinärrecht", "group": "Gesundheit & Umwelt"},
    {"id": "wasserrecht", "label": "Wasserrecht (WRG)", "group": "Gesundheit & Umwelt"},
    {"id": "gesundheitsrecht", "label": "Gesundheitsrecht / Krankenanstalten", "group": "Gesundheit & Umwelt"},
    {"id": "arzneimittelrecht", "label": "Arzneimittelrecht (AMG)", "group": "Gesundheit & Umwelt"},
    {"id": "lebensmittelrecht", "label": "Lebensmittelrecht (LMSVG)", "group": "Gesundheit & Umwelt"},
    {"id": "umweltrecht", "label": "Umweltschutz / Klimaschutz (UVP-G)", "group": "Gesundheit & Umwelt"},
    {"id": "abfallrecht", "label": "Abfallwirtschaft (AWG)", "group": "Gesundheit & Umwelt"},
    {"id": "chemikalienrecht", "label": "Chemikalienrecht / Gentechnik", "group": "Gesundheit & Umwelt"},
    # ── 9: Strafrecht ──
    {"id": "strafrecht", "label": "Strafrecht (StGB)", "group": "Strafrecht"},
    {"id": "nebenstrafrecht", "label": "Nebenstrafrecht (VStG / SMG)", "group": "Strafrecht"},
    {"id": "strafprozess", "label": "Strafprozessrecht (StPO)", "group": "Strafrecht"},
    {"id": "strafvollzug", "label": "Strafvollzug (StVG / JGG)", "group": "Strafrecht"},
    {"id": "opferschutz", "label": "Opferschutz / Bewährungshilfe", "group": "Strafrecht"},
]

# ── RIS Index mapping per Rechtsgebiet ──
# Uses the official Austrian legal classification (Systematische Dezimalklassifikation).
# Format: "XX/YY" where XX = Hauptgruppe, YY = Untergruppe.
# Using just "XX" should match all Untergruppen of that Hauptgruppe.
# Validated: Index=XX/YY works. Index=XX (Hauptgruppe only) returns 0.
# Fallback: Titel parameter for specific laws.
_CATEGORY_SEARCH: dict[str, list[dict]] = {
    # 0/1: Verfassungsrecht
    "verfassungsrecht": [{"Index": "10/01"}, {"Index": "10/02"}, {"Index": "10/03"}, {"Index": "10/14"}, {"Index": "10/15"}],
    "grundrechte": [{"Index": "10/10"}, {"Index": "10/11"}],
    "wahlen": [{"Index": "10/04"}, {"Index": "10/06"}, {"Index": "10/12"}],
    "bezuege": [{"Index": "10/05"}],
    "verfassungsgerichtsbarkeit": [{"Index": "10/07"}],
    "rechnungshof": [{"Index": "10/08"}],
    "amtshaftung": [{"Index": "10/13"}],
    "eu_integration": [{"Index": "10/15"}],
    "aeusseres": [{"Index": "11/01"}, {"Index": "11/02"}, {"Index": "11/03"}, {"Index": "11/04"}],
    "landesverteidigung": [{"Index": "12/01"}, {"Index": "12/02"}, {"Index": "12/03"}, {"Index": "12/04"}],
    "zivildienst": [{"Index": "12/04"}, {"Titel": "Zivildienstgesetz"}],
    "voelkerrecht": [{"Index": "19/01"}, {"Index": "19/02"}, {"Index": "19/03"}, {"Index": "19/04"}],
    # 2: Privatrecht
    "zivilrecht": [{"Index": "20/01"}],
    "handelsrecht": [{"Index": "21/01"}],
    "aktienrecht": [{"Index": "21/02"}],
    "gmbh_recht": [{"Index": "21/03"}],
    "genossenschaftsrecht": [{"Index": "21/04"}],
    "wertpapierrecht": [{"Index": "21/05"}, {"Index": "21/06"}],
    "versicherungsrecht": [{"Index": "21/07"}, {"Titel": "Versicherungsvertragsgesetz"}],
    "zivilprozess": [{"Index": "22/01"}, {"Index": "22/02"}],
    "ausserstreit": [{"Index": "22/03"}, {"Index": "22/04"}],
    "exekutionsrecht": [{"Index": "23/01"}],
    "insolvenzrecht": [{"Index": "23/02"}],
    "justizverwaltung": [{"Index": "24/01"}, {"Index": "24/02"}, {"Index": "24/03"}],
    "notariat": [{"Index": "25/01"}, {"Index": "25/02"}],
    "urheberrecht": [{"Index": "26/01"}],
    "patentrecht": [{"Index": "26/02"}, {"Index": "26/03"}, {"Index": "26/04"}],
    # 3: Finanzrecht
    "finanzrecht_allg": [{"Index": "30/01"}, {"Index": "30/02"}, {"Index": "30/03"}, {"Index": "30/04"}],
    "abgabenrecht": [{"Index": "32/01"}],
    "einkommensteuer": [{"Index": "32/02"}],
    "koerperschaftsteuer": [{"Index": "32/03"}],
    "umsatzsteuer": [{"Index": "32/04"}],
    "gebuehrenrecht": [{"Index": "32/05"}, {"Index": "32/06"}, {"Index": "32/07"}],
    "bewertungsrecht": [{"Index": "33/01"}],
    "zollrecht": [{"Index": "34/01"}, {"Index": "34/02"}],
    "finanzausgleich": [{"Index": "35/01"}, {"Index": "35/02"}],
    "finanzstrafrecht": [{"Index": "32/01"}, {"Titel": "Finanzstrafgesetz"}],
    # 4: Innere Verwaltung
    "verwaltungsverfahren": [{"Index": "40/01"}, {"Index": "40/02"}, {"Index": "40/03"}],
    "staatsbuergerschaft": [{"Index": "41/01"}, {"Index": "41/02"}],
    "personenstandsrecht": [{"Index": "41/03"}, {"Titel": "Personenstandsgesetz"}],
    "sicherheitspolizei": [{"Index": "43/01"}, {"Index": "43/02"}],
    "fremdenrecht": [{"Index": "41/02"}, {"Titel": "Fremdenpolizeigesetz"}, {"Titel": "AsylG"}],
    "waffenrecht": [{"Index": "43/03"}, {"Titel": "Waffengesetz"}],
    "vereinsrecht": [{"Index": "10/11"}, {"Titel": "Vereinsgesetz"}],
    "datenschutz": [{"Index": "10/10"}, {"Titel": "Datenschutzgesetz"}],
    # 5: Gewerbe, Industrie, Handel, Verkehr
    "gewerberecht": [{"Index": "50/01"}, {"Index": "50/02"}, {"Index": "50/03"}],
    "bergrecht": [{"Index": "50/04"}, {"Titel": "Mineralrohstoffgesetz"}],
    "energierecht": [{"Index": "58/01"}, {"Index": "58/02"}],
    "preisrecht": [{"Index": "50/05"}, {"Titel": "UWG"}, {"Titel": "Kartellgesetz"}],
    "bankrecht": [{"Index": "21/06"}, {"Titel": "Bankwesengesetz"}, {"Titel": "WAG"}],
    "verkehrsrecht": [{"Index": "55/01"}, {"Index": "55/02"}, {"Index": "55/03"}],
    "schifffahrt": [{"Index": "55/04"}, {"Titel": "Schifffahrtsgesetz"}],
    "luftfahrt": [{"Index": "55/05"}, {"Titel": "Luftfahrtgesetz"}],
    "eisenbahn": [{"Index": "55/06"}, {"Titel": "Eisenbahngesetz"}],
    "telekommunikation": [{"Index": "56/01"}, {"Index": "56/02"}, {"Titel": "TKG"}],
    "postrecht": [{"Index": "56/03"}, {"Titel": "Postmarktgesetz"}],
    # 6: Arbeitsrecht, Dienstrecht, Sozialrecht
    "arbeitsrecht": [{"Index": "60/01"}, {"Index": "60/02"}, {"Index": "60/03"}, {"Index": "60/04"}, {"Index": "60/05"}],
    "arbeitsschutz": [{"Index": "60/02"}, {"Titel": "ArbeitnehmerInnenschutzgesetz"}],
    "arbeitsmarkt": [{"Index": "60/03"}, {"Titel": "Arbeitslosenversicherungsgesetz"}],
    "beamtendienstrecht": [{"Index": "62/01"}, {"Index": "62/02"}, {"Index": "62/03"}],
    "personalvertretung": [{"Index": "62/04"}, {"Titel": "Personalvertretungsgesetz"}],
    "sozialversicherung": [{"Index": "66/01"}, {"Index": "66/02"}, {"Index": "66/03"}, {"Index": "66/04"}, {"Index": "66/05"}],
    "pensionsrecht": [{"Index": "66/02"}, {"Titel": "Pensionsgesetz"}],
    "pflegegeld": [{"Index": "66/03"}, {"Titel": "Bundespflegegeldgesetz"}],
    "sozialhilfe": [{"Index": "66/04"}, {"Titel": "Sozialhilfe"}],
    # 7: Unterricht, Wissenschaft, Kultur
    "schulrecht": [{"Index": "70/01"}, {"Index": "70/02"}, {"Index": "70/03"}, {"Index": "70/04"}],
    "hochschulrecht": [{"Index": "72/01"}, {"Index": "72/02"}, {"Index": "72/03"}, {"Index": "72/04"}, {"Index": "72/05"}, {"Index": "72/06"}, {"Index": "72/07"}],
    "forschung": [{"Index": "72/01"}, {"Titel": "Forschungsorganisationsgesetz"}],
    "kulturrecht": [{"Index": "75/01"}, {"Index": "75/02"}, {"Titel": "Denkmalschutzgesetz"}],
    "medienfoerderung": [{"Index": "75/03"}, {"Titel": "Presseförderungsgesetz"}],
    "sportrecht": [{"Index": "75/04"}, {"Titel": "Bundes-Sportförderungsgesetz"}],
    # 8: Land-/Forstwirtschaft, Gesundheit, Umwelt
    "landwirtschaft": [{"Index": "80/01"}, {"Index": "80/02"}, {"Index": "80/03"}],
    "tierschutz": [{"Index": "80/04"}, {"Titel": "Tierschutzgesetz"}],
    "wasserrecht": [{"Index": "81/01"}, {"Titel": "Wasserrechtsgesetz"}],
    "gesundheitsrecht": [{"Index": "82/01"}, {"Index": "82/02"}, {"Index": "82/03"}],
    "arzneimittelrecht": [{"Index": "82/03"}, {"Titel": "Arzneimittelgesetz"}],
    "lebensmittelrecht": [{"Index": "82/04"}, {"Titel": "LMSVG"}],
    "umweltrecht": [{"Index": "83/01"}, {"Index": "83/02"}, {"Index": "83/03"}, {"Titel": "UVP-G"}],
    "abfallrecht": [{"Index": "83/03"}, {"Titel": "Abfallwirtschaftsgesetz"}],
    "chemikalienrecht": [{"Index": "83/04"}, {"Titel": "Chemikaliengesetz"}],
    # 9: Strafrecht
    "strafrecht": [{"Index": "90/01"}, {"Index": "90/02"}],
    "nebenstrafrecht": [{"Index": "90/02"}, {"Titel": "Suchtmittelgesetz"}],
    "strafprozess": [{"Index": "91/01"}, {"Index": "91/02"}],
    "strafvollzug": [{"Index": "92/01"}, {"Index": "92/02"}, {"Titel": "Jugendgerichtsgesetz"}],
    "opferschutz": [{"Index": "92/03"}, {"Titel": "Verbrechensopfergesetz"}, {"Titel": "Bewährungshilfegesetz"}],
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
) -> dict:
    """Search Bundesrecht using RIS Index + ImRisSeit.

    Strategy:
    1. Try Index parameter (official legal classification) + ImRisSeit
    2. If 0 hits, fallback to Suchworte (category label) + ImRisSeit
    3. No category → unfiltered ImRisSeit search
    """
    searches = _CATEGORY_SEARCH.get(category, []) if category else []

    if searches:
        return await _search_by_params(searches, im_ris_seit, page)
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


async def _search_by_params(
    searches: list[dict],
    im_ris_seit: str,
    page: int,
) -> dict:
    """Query RIS with multiple search param sets in parallel, combine results.

    Each search dict can have {"Index": "XX/YY"} or {"Titel": "LawName"}.
    """

    # Compute date range for Fassung filter
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
    # Truncate very long titles
    title = betreff or kurztitel or f"{court_name} {case_number}"
    if len(title) > 200:
        title = title[:197] + "..."

    doc_url = _extract_doc_url(m, ref, data_entry)
    normen = _s(m.get("Norm")) or ""
    # Truncate very long normen lists
    if len(normen) > 300:
        normen = normen[:297] + "..."

    # Rechtssatz (legal principle) — short summary if available
    rechtssatz = _s(m.get("Rechtssatz")) or _s(m.get("RechtssatzKurz")) or ""
    if len(rechtssatz) > 500:
        rechtssatz = rechtssatz[:497] + "..."

    # Document type (Entscheidungstext vs Rechtssatz)
    doc_typ = _s(m.get("Dokumenttyp")) or _s(m.get("DokumentTyp")) or ""

    return {
        "id": doc_id,
        "title": title,
        "url": doc_url,
        "date": decision_date,
        "case_number": case_number,
        "court": court_name,
        "normen": normen,
        "rechtssatz": rechtssatz,
        "doc_typ": doc_typ,
    }
