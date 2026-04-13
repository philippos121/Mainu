"""Pydantic domain models for the ERV / Advokat export pipeline.

These models mirror the publicly documented structure of the Austrian
Elektronischer Rechtsverkehr (ERV) "Nachricht"-Strukturdatensatz as well
as the Advokat Akten-Import XML. They are intentionally permissive
(most fields optional) so that partially-filled AI-generated drafts can
still be serialized; strict validation happens at XSD time.
"""

from __future__ import annotations

from datetime import date, datetime
from enum import Enum
from typing import List, Optional

from pydantic import BaseModel, Field, ConfigDict


# ---------------------------------------------------------------------------
# Enums — kept close to the official ERV / Advokat vocabularies
# ---------------------------------------------------------------------------


class NachrichtenArt(str, Enum):
    """Offizielle ERV-Nachrichtenarten (Auszug)."""

    SCHRIFTSATZ = "SV"        # Schriftsatz / Schriftstück
    KLAGE = "KL"              # Klage
    MAHNKLAGE = "MA"          # Mahnklage
    ANTRAG = "AN"             # Antrag
    RECHTSMITTEL = "RM"       # Rechtsmittel (Berufung/Revision/Rekurs)
    ZUSTELLUNG = "ZV"         # Zustellverfügung
    EXEKUTIONSANTRAG = "EX"   # Exekutionsantrag
    GRUNDBUCHANTRAG = "GB"    # Grundbuchantrag
    FIRMENBUCHANTRAG = "FB"   # Firmenbuchantrag
    SONSTIGE = "SO"           # Sonstige


class ParteienRolle(str, Enum):
    KLAEGER = "Kläger"
    BEKLAGTER = "Beklagter"
    ANTRAGSTELLER = "Antragsteller"
    ANTRAGSGEGNER = "Antragsgegner"
    BERUFUNGSWERBER = "Berufungswerber"
    REVISIONSWERBER = "Revisionswerber"
    REKURSWERBER = "Rekurswerber"
    BETROFFENER = "Betroffener"
    DRITTER = "Dritter"
    VERTRETER = "Vertreter"


class DokumentTyp(str, Enum):
    SCHRIFTSATZ = "Schriftsatz"
    BEILAGE = "Beilage"
    URKUNDE = "Urkunde"
    VOLLMACHT = "Vollmacht"
    GUTACHTEN = "Gutachten"
    SONSTIGES = "Sonstiges"


class MimeType(str, Enum):
    PDF = "application/pdf"
    PDF_A = "application/pdf; format=PDF/A"
    DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    XML = "application/xml"
    PLAIN = "text/plain"


# ---------------------------------------------------------------------------
# Basis-Entitäten
# ---------------------------------------------------------------------------


class Adresse(BaseModel):
    strasse: Optional[str] = None
    plz: Optional[str] = None
    ort: Optional[str] = None
    land: str = "AT"


class Partei(BaseModel):
    """Eine Verfahrenspartei (natürliche oder juristische Person)."""

    rolle: ParteienRolle
    name: str = Field(..., description="Nachname oder Firmenwortlaut")
    vorname: Optional[str] = None
    ist_firma: bool = False
    geburtsdatum: Optional[date] = None
    firmenbuchnummer: Optional[str] = Field(
        None, description="FN-Nummer (bei Firmen)"
    )
    zmr_zahl: Optional[str] = Field(
        None, description="ZMR-Zahl (bei natürlichen Personen, optional)"
    )
    adresse: Optional[Adresse] = None
    vertreter_anwalt_code: Optional[str] = Field(
        None, description="ERV-Code des Rechtsanwalts (R-Code), falls vertreten"
    )


class Einbringer(BaseModel):
    """Einbringende Stelle (meist Kanzlei)."""

    kanzlei_name: str
    r_code: str = Field(..., description="R-Code (ERV-Teilnehmer-ID)")
    anwalt_name: Optional[str] = None
    email: Optional[str] = None
    telefon: Optional[str] = None
    adresse: Optional[Adresse] = None


class Gericht(BaseModel):
    """Adressat der Nachricht (Gericht oder Behörde)."""

    gerichts_code: str = Field(..., description="ERV-Gerichtscode, z.B. '0017'")
    bezeichnung: str = Field(..., description="z.B. 'BG Innere Stadt Wien'")
    aktenzeichen: Optional[str] = Field(
        None,
        description="Bestehendes Aktenzeichen, falls eine Eingabe zu einem "
        "anhängigen Verfahren erfolgt.",
    )
    abteilung: Optional[str] = None


class Dokument(BaseModel):
    """Ein Dokument innerhalb einer ERV-Nachricht oder eines Akts."""

    dok_id: str = Field(
        ..., description="Eindeutige ID innerhalb der Nachricht (z.B. 'D001')"
    )
    typ: DokumentTyp = DokumentTyp.SCHRIFTSATZ
    dateiname: str
    mime_type: MimeType = MimeType.PDF
    titel: Optional[str] = None
    beschreibung: Optional[str] = None
    pruefsumme_sha256: Optional[str] = Field(
        None, description="SHA-256 der Datei (hex, lowercase)"
    )
    groesse_bytes: Optional[int] = None
    erstellt_am: Optional[datetime] = None


# ---------------------------------------------------------------------------
# Nachricht-Struktur (ERV / XJustiz-Style)
# ---------------------------------------------------------------------------


class Kopfdaten(BaseModel):
    nachrichten_id: str = Field(..., description="UUID der Nachricht")
    nachrichten_art: NachrichtenArt = NachrichtenArt.SCHRIFTSATZ
    erstellt_am: datetime
    version: str = "1.0"


class Grunddaten(BaseModel):
    einbringer: Einbringer
    gericht: Gericht
    parteien: List[Partei] = Field(default_factory=list)
    streitwert_eur: Optional[float] = None
    verfahrensgegenstand: Optional[str] = None


class Fachdaten(BaseModel):
    """Freiform-Fachdaten — Volltext / strukturierte AI-Outputs."""

    betreff: str
    freitext: Optional[str] = None
    rechtsgebiet: Optional[str] = None
    ris_referenzen: List[str] = Field(
        default_factory=list,
        description="RIS-Dokumentnummern (z.B. BGBLA_2024_II_123)",
    )
    judikatur_referenzen: List[str] = Field(
        default_factory=list,
        description="Geschäftszahlen relevanter Entscheidungen",
    )


class ErvNachricht(BaseModel):
    """Top-level ERV-Nachricht."""

    model_config = ConfigDict(populate_by_name=True)

    kopfdaten: Kopfdaten
    grunddaten: Grunddaten
    fachdaten: Fachdaten
    dokumente: List[Dokument] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Advokat-Akten-Import
# ---------------------------------------------------------------------------


class AdvokatAkt(BaseModel):
    """Akt für den Advokat-Import (Akten-XML)."""

    akt_nummer: Optional[str] = Field(
        None,
        description=(
            "Aktenzeichen in Advokat; wenn leer, vergibt Advokat beim "
            "Import eine neue Nummer."
        ),
    )
    akt_bezeichnung: str
    mandant_name: str
    mandant_vorname: Optional[str] = None
    gegner_name: Optional[str] = None
    gegner_vorname: Optional[str] = None
    rechtsgebiet: Optional[str] = None
    sachbearbeiter: Optional[str] = None
    eroeffnet_am: Optional[date] = None
    streitwert_eur: Optional[float] = None
    aktenzeichen_gericht: Optional[str] = None
    gericht: Optional[Gericht] = None
    parteien: List[Partei] = Field(default_factory=list)
    dokumente: List[Dokument] = Field(default_factory=list)
    notizen: Optional[str] = None
