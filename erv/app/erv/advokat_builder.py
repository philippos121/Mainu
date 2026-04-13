"""Builder für Advokat-Akten-Import-XML.

Erzeugt eine XML-Datei, die sich über die Advokat-Import-Funktion
(Advokat Unternehmensberatung GmbH) als neuer Akt anlegen bzw. einem
bestehenden Akt Dokumente hinzufügen lässt.

Das XML folgt dem öffentlich dokumentierten Advokat-Akten-Schema mit
Wurzelelement `<AdvokatImport>` → `<Akt>` → {Parteien, Dokumente}.

Feldnamen entsprechen so weit wie möglich der Advokat-Oberfläche
(Aktnummer, Aktbezeichnung, Mandant, Gegner, Rechtsgebiet, …) damit
eine 1:1-Zuordnung beim Import gelingt.
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from lxml import etree

from .models import AdvokatAkt, Dokument, Partei


ADVOKAT_NS = "http://schema.advokat.at/akten-import/1.0"
NSMAP = {None: ADVOKAT_NS}


def _qn(tag: str) -> str:
    return f"{{{ADVOKAT_NS}}}{tag}"


def _sub(parent: etree._Element, tag: str, text: Optional[str] = None) -> etree._Element:
    el = etree.SubElement(parent, _qn(tag))
    if text is not None:
        el.text = str(text)
    return el


def _partei_to_xml(parent: etree._Element, p: Partei) -> None:
    pel = _sub(parent, "Partei")
    pel.set("Rolle", p.rolle.value)
    if p.ist_firma:
        _sub(pel, "Firmenwortlaut", p.name)
        if p.firmenbuchnummer:
            _sub(pel, "FN", p.firmenbuchnummer)
    else:
        _sub(pel, "Nachname", p.name)
        if p.vorname:
            _sub(pel, "Vorname", p.vorname)
        if p.geburtsdatum:
            _sub(pel, "Geburtsdatum", p.geburtsdatum.isoformat())
    if p.adresse:
        adr = _sub(pel, "Adresse")
        if p.adresse.strasse:
            _sub(adr, "Strasse", p.adresse.strasse)
        if p.adresse.plz:
            _sub(adr, "PLZ", p.adresse.plz)
        if p.adresse.ort:
            _sub(adr, "Ort", p.adresse.ort)
        _sub(adr, "Land", p.adresse.land or "AT")
    if p.vertreter_anwalt_code:
        _sub(pel, "Vertreter-RCode", p.vertreter_anwalt_code)


def _dokument_to_xml(parent: etree._Element, d: Dokument) -> None:
    dok = _sub(parent, "Schriftstueck")
    dok.set("Id", d.dok_id)
    _sub(dok, "Bezeichnung", d.titel or d.dateiname)
    _sub(dok, "Dateiname", d.dateiname)
    _sub(dok, "Typ", d.typ.value)
    _sub(dok, "MimeType", d.mime_type.value)
    if d.beschreibung:
        _sub(dok, "Anmerkung", d.beschreibung)
    if d.erstellt_am:
        _sub(dok, "ErstelltAm", d.erstellt_am.isoformat())
    if d.pruefsumme_sha256:
        ps = _sub(dok, "Pruefsumme", d.pruefsumme_sha256)
        ps.set("Algorithmus", "SHA-256")


def build_advokat_xml(akt: AdvokatAkt) -> bytes:
    """Serialisiert einen :class:`AdvokatAkt` zu Advokat-Import-XML."""

    root = etree.Element(_qn("AdvokatImport"), nsmap=NSMAP)
    root.set("version", "1.0")
    root.set("erstelltAm", datetime.utcnow().isoformat())

    akt_el = _sub(root, "Akt")

    if akt.akt_nummer:
        _sub(akt_el, "Aktnummer", akt.akt_nummer)
    _sub(akt_el, "Aktbezeichnung", akt.akt_bezeichnung)

    mandant = _sub(akt_el, "Mandant")
    _sub(mandant, "Nachname", akt.mandant_name)
    if akt.mandant_vorname:
        _sub(mandant, "Vorname", akt.mandant_vorname)

    if akt.gegner_name:
        gegner = _sub(akt_el, "Gegner")
        _sub(gegner, "Nachname", akt.gegner_name)
        if akt.gegner_vorname:
            _sub(gegner, "Vorname", akt.gegner_vorname)

    if akt.rechtsgebiet:
        _sub(akt_el, "Rechtsgebiet", akt.rechtsgebiet)
    if akt.sachbearbeiter:
        _sub(akt_el, "Sachbearbeiter", akt.sachbearbeiter)
    if akt.eroeffnet_am:
        _sub(akt_el, "EroeffnetAm", akt.eroeffnet_am.isoformat())
    if akt.streitwert_eur is not None:
        sw = _sub(akt_el, "Streitwert", f"{akt.streitwert_eur:.2f}")
        sw.set("Waehrung", "EUR")
    if akt.aktenzeichen_gericht:
        _sub(akt_el, "GeschaeftszahlGericht", akt.aktenzeichen_gericht)

    if akt.gericht:
        g_el = _sub(akt_el, "Gericht")
        _sub(g_el, "GerichtsCode", akt.gericht.gerichts_code)
        _sub(g_el, "Bezeichnung", akt.gericht.bezeichnung)
        if akt.gericht.abteilung:
            _sub(g_el, "Abteilung", akt.gericht.abteilung)

    if akt.parteien:
        parteien_el = _sub(akt_el, "Parteien")
        for p in akt.parteien:
            _partei_to_xml(parteien_el, p)

    if akt.dokumente:
        dok_el = _sub(akt_el, "Schriftstuecke")
        for d in akt.dokumente:
            _dokument_to_xml(dok_el, d)

    if akt.notizen:
        _sub(akt_el, "Notizen", akt.notizen)

    return etree.tostring(
        root,
        pretty_print=True,
        xml_declaration=True,
        encoding="UTF-8",
        standalone=True,
    )
