"""FastAPI-Integrationstests."""

from __future__ import annotations

import base64
import io
import json
import zipfile

import pytest
from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def test_health():
    r = client.get("/api/erv/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_schemas_endpoint():
    r = client.get("/api/erv/schemas")
    assert r.status_code == 200
    data = r.json()
    assert "erv-nachricht-1.0.xsd" in data
    assert "advokat-import-1.0.xsd" in data
    # Kein XJustiz in den AT-Schemas
    for xsd in data.values():
        assert "xjustiz" not in xsd.lower()


def _from_ai_payload(zielformat: str) -> dict:
    return {
        "ai_output": {
            "betreff": "Klage",
            "freitext": "Text…",
            "rechtsgebiet": "Zivilrecht",
            "streitwert_eur": 5000.0,
        },
        "einbringer": {
            "kanzlei_name": "AI:SSOCIATE",
            "r_code": "R123456",
            "anwalt_name": "Dr. Musterhofer",
        },
        "gericht": {"gerichts_code": "0017", "bezeichnung": "BG Innere Stadt Wien"},
        "parteien": [
            {"rolle": "Kläger", "name": "Mustermann", "vorname": "Max"},
            {"rolle": "Beklagter", "name": "ACME GmbH", "ist_firma": True},
        ],
        "nachrichten_art": "KL",
        "zielformat": zielformat,
    }


def test_from_ai_erv_xml():
    r = client.post("/api/erv/from-ai", json=_from_ai_payload("erv"))
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/xml")
    assert b"edikte.justiz.gv.at/erv" in r.content
    assert b"R123456" in r.content


def test_from_ai_advokat_xml():
    r = client.post("/api/erv/from-ai", json=_from_ai_payload("advokat"))
    assert r.status_code == 200
    assert b"AdvokatImport" in r.content
    assert b"schema.advokat.at" in r.content


def test_from_ai_zip_beides():
    payload = _from_ai_payload("beides")
    payload["pdf_anhang"] = {
        "dateiname": "klage.pdf",
        "mime_type": "application/pdf",
        "inhalt_base64": base64.b64encode(b"%PDF-1.7 FAKE").decode(),
    }
    r = client.post("/api/erv/from-ai", json=payload)
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/zip"

    with zipfile.ZipFile(io.BytesIO(r.content)) as zf:
        names = set(zf.namelist())
        assert "nachricht.xml" in names
        assert "manifest.json" in names
        assert "anhaenge/klage.pdf" in names
        assert "anhaenge/advokat-akt.xml" in names


def test_validieren_endpoint_detects_erv():
    # Erzeuge gültiges ERV-XML via /from-ai
    r = client.post("/api/erv/from-ai", json=_from_ai_payload("erv"))
    xml_bytes = r.content

    r2 = client.post(
        "/api/erv/validieren",
        files={"file": ("nachricht.xml", xml_bytes, "application/xml")},
    )
    assert r2.status_code == 200
    data = r2.json()
    assert data["valid"] is True
    assert "erv" in data["schema"]


def test_from_ai_zielformat_unbekannt():
    payload = _from_ai_payload("foo")
    r = client.post("/api/erv/from-ai", json=payload)
    assert r.status_code == 400
