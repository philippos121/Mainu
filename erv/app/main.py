"""ERV-Export-API — FastAPI-Service.

Bietet Endpoints zum Erzeugen, Validieren und Paketieren von
österreichischen ERV-Nachrichten (webERV) sowie zum Export in
Advokat-kompatiblem Akten-XML.
"""

from __future__ import annotations

import base64
import io
import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field

from app.erv.advokat_builder import build_advokat_xml
from app.erv.ai_bridge import (
    ai_result_to_erv_nachricht,
    erv_nachricht_to_advokat,
)
from app.erv.erv_builder import build_erv_nachricht_xml
from app.erv.models import (
    AdvokatAkt,
    Einbringer,
    ErvNachricht,
    Gericht,
    NachrichtenArt,
    Partei,
)
from app.erv.package import Anhang, annotate_dokumente_with_hashes, build_zip_package
from app.erv.validation import (
    available_schemas,
    detect_and_validate,
    validate_advokat,
    validate_erv,
)


logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("erv")

app = FastAPI(
    title="ERV Export API (AI:SSOCIATE)",
    version="1.0.0",
    description=(
        "Export von Legal-AI-Output in österreichische ERV-Nachrichten "
        "(webERV) sowie in Advokat-kompatible Akten-Import-XML. "
        "Kein XJustiz — rein Österreich."
    ),
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Request-Modelle
# ---------------------------------------------------------------------------


class Base64Anhang(BaseModel):
    dateiname: str
    mime_type: str = "application/pdf"
    inhalt_base64: str = Field(
        ..., description="Base64-kodierter Dateiinhalt (z.B. PDF)"
    )


class PaketRequest(BaseModel):
    nachricht: ErvNachricht
    anhaenge: List[Base64Anhang] = Field(default_factory=list)


class FromAiRequest(BaseModel):
    ai_output: Dict[str, Any] = Field(
        ...,
        description=(
            "Output der Legal-AI / LexWatch API. Bekannte Keys: betreff, "
            "freitext, rechtsgebiet, ris_referenzen, judikatur_referenzen, "
            "verfahrensgegenstand, streitwert_eur."
        ),
    )
    einbringer: Einbringer
    gericht: Gericht
    parteien: List[Partei] = Field(default_factory=list)
    nachrichten_art: NachrichtenArt = NachrichtenArt.SCHRIFTSATZ
    pdf_anhang: Optional[Base64Anhang] = None
    zielformat: str = Field(
        "erv",
        description="'erv' für ERV-XML, 'advokat' für Advokat-XML, 'beides' für ZIP",
    )


# ---------------------------------------------------------------------------
# Utils
# ---------------------------------------------------------------------------


def _decode_anhaenge(list_: List[Base64Anhang]) -> List[Anhang]:
    result: List[Anhang] = []
    for a in list_:
        try:
            raw = base64.b64decode(a.inhalt_base64)
        except Exception as e:
            raise HTTPException(
                status_code=400,
                detail=f"Anhang '{a.dateiname}' hat ungültiges Base64: {e}",
            )
        # MimeType -> enum if possible, sonst fallback PDF
        from app.erv.models import MimeType

        try:
            mt = MimeType(a.mime_type)
        except ValueError:
            mt = MimeType.PDF
        result.append(Anhang(dateiname=a.dateiname, inhalt=raw, mime_type=mt))
    return result


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@app.get("/api/erv/health")
async def health():
    return {"status": "ok", "zeit": datetime.utcnow().isoformat() + "Z"}


@app.get("/api/erv/schemas")
async def schemas():
    return available_schemas()


@app.post("/api/erv/nachricht")
async def erv_nachricht(nachricht: ErvNachricht):
    """Erzeugt das ERV-Nachricht-XML (AT, webERV) aus strukturierten Daten."""
    xml_bytes = build_erv_nachricht_xml(nachricht)
    vr = validate_erv(xml_bytes)
    if not vr.valid:
        logger.warning("Generiertes ERV-XML ist nicht schema-valid: %s", vr.fehler)
    return Response(
        content=xml_bytes,
        media_type="application/xml",
        headers={
            "Content-Disposition": (
                f'attachment; filename="erv-{nachricht.kopfdaten.nachrichten_id}.xml"'
            ),
            "X-ERV-Valid": "true" if vr.valid else "false",
        },
    )


@app.post("/api/erv/advokat")
async def advokat_export(akt: AdvokatAkt):
    """Erzeugt Advokat-Akten-Import-XML."""
    xml_bytes = build_advokat_xml(akt)
    vr = validate_advokat(xml_bytes)
    filename = (
        f"advokat-akt-{akt.akt_nummer or akt.akt_bezeichnung.replace(' ', '_')}.xml"
    )
    return Response(
        content=xml_bytes,
        media_type="application/xml",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-Advokat-Valid": "true" if vr.valid else "false",
        },
    )


@app.post("/api/erv/paket")
async def erv_paket(req: PaketRequest):
    """Packt ERV-XML + PDF-Anhänge zu einem ZIP-Paket.

    Das ZIP enthält ``nachricht.xml``, ``manifest.json`` und alle
    Anhänge unter ``anhaenge/…`` — fertig für die Einreichung
    über einen ERV-Gateway-Provider.
    """
    anhaenge = _decode_anhaenge(req.anhaenge)

    # Hashes der Anhänge in die Dokument-Liste der Nachricht eintragen
    nachricht = req.nachricht.model_copy(
        update={"dokumente": annotate_dokumente_with_hashes(req.nachricht.dokumente, anhaenge)}
    )

    xml_bytes = build_erv_nachricht_xml(nachricht)
    zip_bytes, manifest = build_zip_package(xml_bytes, anhaenge)

    return StreamingResponse(
        io.BytesIO(zip_bytes),
        media_type="application/zip",
        headers={
            "Content-Disposition": (
                f'attachment; filename="erv-paket-{nachricht.kopfdaten.nachrichten_id}.zip"'
            ),
            "X-Manifest-Sha256": manifest["nachricht"]["sha256"],
        },
    )


@app.post("/api/erv/validieren")
async def validieren(file: UploadFile = File(...)):
    """Validiert ein hochgeladenes XML gegen die mitgelieferten XSDs."""
    data = await file.read()
    vr = detect_and_validate(data)
    return vr.to_dict()


@app.post("/api/erv/from-ai")
async def from_ai(req: FromAiRequest):
    """End-to-End: AI-Output → ERV-Nachricht (+ optional Advokat/ZIP)."""
    pdf_dateiname = req.pdf_anhang.dateiname if req.pdf_anhang else "schriftsatz.pdf"

    nachricht = ai_result_to_erv_nachricht(
        ai_output=req.ai_output,
        einbringer=req.einbringer,
        gericht=req.gericht,
        parteien=req.parteien,
        nachrichten_art=req.nachrichten_art,
        pdf_dateiname=pdf_dateiname,
    )

    anhaenge = _decode_anhaenge([req.pdf_anhang]) if req.pdf_anhang else []
    if anhaenge:
        nachricht = nachricht.model_copy(
            update={
                "dokumente": annotate_dokumente_with_hashes(
                    nachricht.dokumente, anhaenge
                )
            }
        )

    erv_xml = build_erv_nachricht_xml(nachricht)
    advokat_xml = build_advokat_xml(erv_nachricht_to_advokat(nachricht))

    if req.zielformat == "erv":
        return Response(
            content=erv_xml,
            media_type="application/xml",
            headers={
                "Content-Disposition": f'attachment; filename="erv-{nachricht.kopfdaten.nachrichten_id}.xml"'
            },
        )
    if req.zielformat == "advokat":
        return Response(
            content=advokat_xml,
            media_type="application/xml",
            headers={
                "Content-Disposition": f'attachment; filename="advokat-{nachricht.kopfdaten.nachrichten_id}.xml"'
            },
        )
    if req.zielformat == "beides":
        # Zwei XMLs + Anhänge in einem ZIP
        zip_anhaenge = list(anhaenge)
        zip_anhaenge.append(
            Anhang(
                dateiname="advokat-akt.xml",
                inhalt=advokat_xml,
                mime_type=__import__(
                    "app.erv.models", fromlist=["MimeType"]
                ).MimeType.XML,
            )
        )
        zip_bytes, _ = build_zip_package(erv_xml, zip_anhaenge)
        return StreamingResponse(
            io.BytesIO(zip_bytes),
            media_type="application/zip",
            headers={
                "Content-Disposition": f'attachment; filename="erv-paket-{nachricht.kopfdaten.nachrichten_id}.zip"'
            },
        )

    raise HTTPException(
        status_code=400,
        detail=f"Unbekanntes zielformat: {req.zielformat!r}. Erlaubt: erv|advokat|beides",
    )
