"""Builder für österreichische ERV-Nachrichten (webERV).

Erzeugt XML gemäß dem vom BMJ / BRZ publizierten Strukturdatensatz
für den Elektronischen Rechtsverkehr (AT). Dies ist **nicht** XJustiz
(das ist ein deutscher Standard) — es ist ausschließlich das
österreichische ERV-Format mit Gerichts-Codes, R-Codes der
Einbringer-Kanzlei und den im ERV-Handbuch definierten Elementen.

Root-Element: `<ervNachricht>` im Namespace
`http://www.edikte.justiz.gv.at/erv/nachricht/1.0`.
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from lxml import etree

from .models import (
    Adresse,
    Dokument,
    ErvNachricht,
    Einbringer,
    Gericht,
    Partei,
)


ERV_NS = "http://www.edikte.justiz.gv.at/erv/nachricht/1.0"
XSI_NS = "http://www.w3.org/2001/XMLSchema-instance"

NSMAP = {None: ERV_NS, "xsi": XSI_NS}


def _qn(tag: str) -> str:
    return f"{{{ERV_NS}}}{tag}"


def _sub(parent: etree._Element, tag: str, text: Optional[str] = None) -> etree._Element:
    el = etree.SubElement(parent, _qn(tag))
    if text is not None:
        el.text = str(text)
    return el


def _adresse_to_xml(parent: etree._Element, adr: Adresse) -> None:
    adr_el = _sub(parent, "Adresse")
    if adr.strasse:
        _sub(adr_el, "Strasse", adr.strasse)
    if adr.plz:
        _sub(adr_el, "Plz", adr.plz)
    if adr.ort:
        _sub(adr_el, "Ort", adr.ort)
    _sub(adr_el, "Land", adr.land or "AT")


def _partei_to_xml(parent: etree._Element, p: Partei) -> None:
    pel = _sub(parent, "Partei")
    pel.set("rolle", p.rolle.value)
    if p.ist_firma:
        firma = _sub(pel, "Firma")
        _sub(firma, "Firmenwortlaut", p.name)
        if p.firmenbuchnummer:
            _sub(firma, "Firmenbuchnummer", p.firmenbuchnummer)
    else:
        person = _sub(pel, "NatuerlichePerson")
        _sub(person, "Nachname", p.name)
        if p.vorname:
            _sub(person, "Vorname", p.vorname)
        if p.geburtsdatum:
            _sub(person, "Geburtsdatum", p.geburtsdatum.isoformat())
        if p.zmr_zahl:
            _sub(person, "ZmrZahl", p.zmr_zahl)
    if p.adresse:
        _adresse_to_xml(pel, p.adresse)
    if p.vertreter_anwalt_code:
        vert = _sub(pel, "Vertreter")
        _sub(vert, "RCode", p.vertreter_anwalt_code)


def _einbringer_to_xml(parent: etree._Element, e: Einbringer) -> None:
    ein = _sub(parent, "Einbringer")
    _sub(ein, "RCode", e.r_code)
    _sub(ein, "KanzleiName", e.kanzlei_name)
    if e.anwalt_name:
        _sub(ein, "AnwaltName", e.anwalt_name)
    if e.email:
        _sub(ein, "Email", e.email)
    if e.telefon:
        _sub(ein, "Telefon", e.telefon)
    if e.adresse:
        _adresse_to_xml(ein, e.adresse)


def _gericht_to_xml(parent: etree._Element, g: Gericht) -> None:
    gel = _sub(parent, "Gericht")
    _sub(gel, "GerichtsCode", g.gerichts_code)
    _sub(gel, "Bezeichnung", g.bezeichnung)
    if g.abteilung:
        _sub(gel, "Abteilung", g.abteilung)
    if g.aktenzeichen:
        _sub(gel, "Geschaeftszahl", g.aktenzeichen)


def _dokument_to_xml(parent: etree._Element, d: Dokument) -> None:
    dok = _sub(parent, "Dokument")
    dok.set("id", d.dok_id)
    dok.set("typ", d.typ.value)
    _sub(dok, "Dateiname", d.dateiname)
    _sub(dok, "MimeType", d.mime_type.value)
    if d.titel:
        _sub(dok, "Titel", d.titel)
    if d.beschreibung:
        _sub(dok, "Beschreibung", d.beschreibung)
    if d.pruefsumme_sha256:
        ps = _sub(dok, "Pruefsumme", d.pruefsumme_sha256)
        ps.set("algorithmus", "SHA-256")
    if d.groesse_bytes is not None:
        _sub(dok, "GroesseBytes", str(d.groesse_bytes))
    if d.erstellt_am:
        _sub(dok, "ErstelltAm", d.erstellt_am.isoformat())


def build_erv_nachricht_xml(nachricht: ErvNachricht) -> bytes:
    """Serialisiert eine :class:`ErvNachricht` zu ERV-konformem XML (AT)."""

    root = etree.Element(_qn("ervNachricht"), nsmap=NSMAP)
    root.set("version", nachricht.kopfdaten.version)

    # --- Kopfdaten ---------------------------------------------------------
    kopf = _sub(root, "Kopfdaten")
    _sub(kopf, "NachrichtenId", nachricht.kopfdaten.nachrichten_id)
    _sub(kopf, "NachrichtenArt", nachricht.kopfdaten.nachrichten_art.value)
    _sub(
        kopf,
        "ErstelltAm",
        (nachricht.kopfdaten.erstellt_am or datetime.utcnow()).isoformat(),
    )

    # --- Grunddaten --------------------------------------------------------
    grund = _sub(root, "Grunddaten")
    _einbringer_to_xml(grund, nachricht.grunddaten.einbringer)
    _gericht_to_xml(grund, nachricht.grunddaten.gericht)
    if nachricht.grunddaten.parteien:
        parteien_el = _sub(grund, "Parteien")
        for p in nachricht.grunddaten.parteien:
            _partei_to_xml(parteien_el, p)
    if nachricht.grunddaten.streitwert_eur is not None:
        sw = _sub(grund, "Streitwert", f"{nachricht.grunddaten.streitwert_eur:.2f}")
        sw.set("waehrung", "EUR")
    if nachricht.grunddaten.verfahrensgegenstand:
        _sub(grund, "Verfahrensgegenstand", nachricht.grunddaten.verfahrensgegenstand)

    # --- Fachdaten ---------------------------------------------------------
    fach = _sub(root, "Fachdaten")
    _sub(fach, "Betreff", nachricht.fachdaten.betreff)
    if nachricht.fachdaten.rechtsgebiet:
        _sub(fach, "Rechtsgebiet", nachricht.fachdaten.rechtsgebiet)
    if nachricht.fachdaten.freitext:
        _sub(fach, "Freitext", nachricht.fachdaten.freitext)
    if nachricht.fachdaten.ris_referenzen:
        refs = _sub(fach, "RisReferenzen")
        for r in nachricht.fachdaten.ris_referenzen:
            _sub(refs, "Dokumentnummer", r)
    if nachricht.fachdaten.judikatur_referenzen:
        jrefs = _sub(fach, "JudikaturReferenzen")
        for j in nachricht.fachdaten.judikatur_referenzen:
            _sub(jrefs, "Geschaeftszahl", j)

    # --- Dokumente ---------------------------------------------------------
    if nachricht.dokumente:
        dok_el = _sub(root, "Dokumente")
        for d in nachricht.dokumente:
            _dokument_to_xml(dok_el, d)

    return etree.tostring(
        root,
        pretty_print=True,
        xml_declaration=True,
        encoding="UTF-8",
        standalone=True,
    )
