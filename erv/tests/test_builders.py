"""End-to-end tests für Builder, Validator und ZIP-Packaging."""

from __future__ import annotations

import io
import json
import zipfile
from datetime import date, datetime

import pytest

from app.erv.advokat_builder import build_advokat_xml
from app.erv.ai_bridge import ai_result_to_erv_nachricht, erv_nachricht_to_advokat
from app.erv.erv_builder import build_erv_nachricht_xml
from app.erv.models import (
    Adresse,
    DokumentTyp,
    Einbringer,
    Gericht,
    NachrichtenArt,
    Partei,
    ParteienRolle,
)
from app.erv.package import Anhang, build_zip_package
from app.erv.validation import detect_and_validate, validate_advokat, validate_erv


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def einbringer() -> Einbringer:
    return Einbringer(
        kanzlei_name="AI:SSOCIATE Rechtsanwälte GmbH",
        r_code="R123456",
        anwalt_name="Dr. Musterhofer",
        email="kanzlei@aissociate.at",
        adresse=Adresse(strasse="Kärntner Ring 10", plz="1010", ort="Wien"),
    )


@pytest.fixture
def gericht() -> Gericht:
    return Gericht(
        gerichts_code="0017",
        bezeichnung="BG Innere Stadt Wien",
        aktenzeichen="4 C 123/26",
        abteilung="4",
    )


@pytest.fixture
def parteien() -> list[Partei]:
    return [
        Partei(
            rolle=ParteienRolle.KLAEGER,
            name="Mustermann",
            vorname="Max",
            geburtsdatum=date(1980, 5, 12),
            adresse=Adresse(strasse="Musterweg 1", plz="1020", ort="Wien"),
            vertreter_anwalt_code="R123456",
        ),
        Partei(
            rolle=ParteienRolle.BEKLAGTER,
            name="ACME Handels GmbH",
            ist_firma=True,
            firmenbuchnummer="FN 123456a",
        ),
    ]


@pytest.fixture
def nachricht(einbringer, gericht, parteien):
    return ai_result_to_erv_nachricht(
        ai_output={
            "betreff": "Klage auf EUR 12.500",
            "freitext": "Werklohnklage…",
            "rechtsgebiet": "Zivilrecht",
            "ris_referenzen": ["ABGB §§ 1151 ff"],
            "streitwert_eur": 12500.0,
            "verfahrensgegenstand": "Werklohn",
        },
        einbringer=einbringer,
        gericht=gericht,
        parteien=parteien,
        nachrichten_art=NachrichtenArt.KLAGE,
        pdf_dateiname="klage.pdf",
    )


# ---------------------------------------------------------------------------
# ERV Builder + XSD
# ---------------------------------------------------------------------------


def test_erv_xml_contains_austrian_namespace(nachricht):
    xml = build_erv_nachricht_xml(nachricht)
    assert b"edikte.justiz.gv.at/erv/nachricht/1.0" in xml
    assert b"ervNachricht" in xml
    # Sicherheitscheck: kein XJustiz
    assert b"xjustiz" not in xml.lower()


def test_erv_xml_validates_against_xsd(nachricht):
    xml = build_erv_nachricht_xml(nachricht)
    result = validate_erv(xml)
    assert result.valid, f"XSD-Fehler: {result.fehler}"


def test_erv_xml_enthaelt_rcode_und_gerichtscode(nachricht):
    xml = build_erv_nachricht_xml(nachricht).decode()
    assert "R123456" in xml
    assert "0017" in xml
    assert "4 C 123/26" in xml


def test_erv_xml_enthaelt_firma_und_natuerliche_person(nachricht):
    xml = build_erv_nachricht_xml(nachricht).decode()
    assert "Firmenwortlaut" in xml
    assert "ACME Handels GmbH" in xml
    assert "Nachname" in xml
    assert "Mustermann" in xml


def test_erv_xml_streitwert_in_eur(nachricht):
    xml = build_erv_nachricht_xml(nachricht).decode()
    assert "12500.00" in xml
    assert 'waehrung="EUR"' in xml


# ---------------------------------------------------------------------------
# Advokat Builder + XSD
# ---------------------------------------------------------------------------


def test_advokat_xml_validates(nachricht):
    akt = erv_nachricht_to_advokat(nachricht)
    xml = build_advokat_xml(akt)
    result = validate_advokat(xml)
    assert result.valid, f"Advokat-XSD-Fehler: {result.fehler}"


def test_advokat_xml_mapped_mandant_and_gegner(nachricht):
    akt = erv_nachricht_to_advokat(nachricht)
    xml = build_advokat_xml(akt).decode()
    assert "Mustermann" in xml      # Mandant
    assert "ACME Handels GmbH" in xml  # Gegner als Firma
    assert "AdvokatImport" in xml
    assert "schema.advokat.at/akten-import" in xml


# ---------------------------------------------------------------------------
# detect_and_validate
# ---------------------------------------------------------------------------


def test_detect_erv(nachricht):
    xml = build_erv_nachricht_xml(nachricht)
    vr = detect_and_validate(xml)
    assert vr.valid
    assert "erv" in vr.schema


def test_detect_advokat(nachricht):
    akt = erv_nachricht_to_advokat(nachricht)
    xml = build_advokat_xml(akt)
    vr = detect_and_validate(xml)
    assert vr.valid
    assert "advokat" in vr.schema


def test_detect_unknown_namespace():
    vr = detect_and_validate(b"<foo xmlns='urn:x'/>")
    assert not vr.valid
    assert any("Namespace" in e for e in vr.fehler)


# ---------------------------------------------------------------------------
# ZIP-Paketierung
# ---------------------------------------------------------------------------


def test_zip_package_contains_xml_manifest_and_attachments(nachricht):
    xml = build_erv_nachricht_xml(nachricht)
    anh = [
        Anhang(dateiname="klage.pdf", inhalt=b"%PDF-1.7\n...FAKE..."),
        Anhang(dateiname="beilage-a.pdf", inhalt=b"%PDF-1.7\n...B..."),
    ]
    zip_bytes, manifest = build_zip_package(xml, anh)

    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        names = set(zf.namelist())
        assert "nachricht.xml" in names
        assert "manifest.json" in names
        assert "anhaenge/klage.pdf" in names
        assert "anhaenge/beilage-a.pdf" in names

        mf = json.loads(zf.read("manifest.json"))
        assert mf["nachricht"]["dateiname"] == "nachricht.xml"
        assert len(mf["anhaenge"]) == 2
        # Prüfsummen stimmen
        for item in mf["anhaenge"]:
            inhalt = zf.read(item["pfad"])
            import hashlib
            assert hashlib.sha256(inhalt).hexdigest() == item["sha256"]


def test_manifest_reflects_xml_hash(nachricht):
    xml = build_erv_nachricht_xml(nachricht)
    _, manifest = build_zip_package(xml, [])
    import hashlib
    assert manifest["nachricht"]["sha256"] == hashlib.sha256(xml).hexdigest()


# ---------------------------------------------------------------------------
# Smoke-Test: AI → ERV → Advokat
# ---------------------------------------------------------------------------


def test_ai_bridge_produces_valid_chain(einbringer, gericht, parteien):
    nachricht = ai_result_to_erv_nachricht(
        ai_output={"betreff": "Antrag", "rechtsgebiet": "Verwaltungsrecht"},
        einbringer=einbringer,
        gericht=gericht,
        parteien=parteien,
        nachrichten_art=NachrichtenArt.ANTRAG,
    )
    erv_xml = build_erv_nachricht_xml(nachricht)
    assert validate_erv(erv_xml).valid

    akt = erv_nachricht_to_advokat(nachricht)
    assert akt.akt_bezeichnung == "Antrag"
    adv_xml = build_advokat_xml(akt)
    assert validate_advokat(adv_xml).valid
