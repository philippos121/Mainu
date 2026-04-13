"""ZIP-Paketierung für ERV-Exporte.

Ein ERV-Paket besteht aus:
  nachricht.xml        — ERV-Nachricht (webERV AT) oder Advokat-XML
  manifest.json        — Maschinenlesbares Inhaltsverzeichnis
  anhaenge/<datei>.pdf — Beigefügte PDF-Dokumente (referenziert in XML)

Das Paket ist so gestaltet, dass es sowohl von einem ERV-Gateway
(Postserver, BRZ, manz.at) verarbeitet als auch direkt in
Kanzleisoftware wie Advokat über deren Akten-Import eingelesen
werden kann.
"""

from __future__ import annotations

import hashlib
import io
import json
import zipfile
from dataclasses import dataclass
from datetime import datetime
from typing import Dict, List, Optional, Tuple

from .models import Dokument, MimeType


@dataclass
class Anhang:
    """Ein einzelner Dateianhang im ERV-Paket."""

    dateiname: str
    inhalt: bytes
    mime_type: MimeType = MimeType.PDF

    def sha256_hex(self) -> str:
        return hashlib.sha256(self.inhalt).hexdigest()

    def groesse(self) -> int:
        return len(self.inhalt)


def build_zip_package(
    nachricht_xml: bytes,
    anhaenge: List[Anhang],
    *,
    xml_dateiname: str = "nachricht.xml",
    zusatz_metadaten: Optional[Dict] = None,
) -> Tuple[bytes, Dict]:
    """Packt ERV-XML + Anhänge zu einem ZIP-Archiv.

    Liefert (zip_bytes, manifest_dict). Das Manifest wird **auch**
    als ``manifest.json`` in das ZIP geschrieben.
    """

    manifest = {
        "version": "1.0",
        "erstellt_am": datetime.utcnow().isoformat() + "Z",
        "nachricht": {
            "dateiname": xml_dateiname,
            "groesse_bytes": len(nachricht_xml),
            "sha256": hashlib.sha256(nachricht_xml).hexdigest(),
        },
        "anhaenge": [
            {
                "dateiname": a.dateiname,
                "pfad": f"anhaenge/{a.dateiname}",
                "mime_type": a.mime_type.value,
                "groesse_bytes": a.groesse(),
                "sha256": a.sha256_hex(),
            }
            for a in anhaenge
        ],
    }
    if zusatz_metadaten:
        manifest["meta"] = zusatz_metadaten

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(xml_dateiname, nachricht_xml)
        zf.writestr(
            "manifest.json",
            json.dumps(manifest, indent=2, ensure_ascii=False).encode("utf-8"),
        )
        for a in anhaenge:
            zf.writestr(f"anhaenge/{a.dateiname}", a.inhalt)

    return buf.getvalue(), manifest


def annotate_dokumente_with_hashes(
    dokumente: List[Dokument], anhaenge: List[Anhang]
) -> List[Dokument]:
    """Trägt Prüfsumme + Größe der Anhänge in die Dokument-Liste ein.

    Matched per Dateiname. Unveränderte Dokumente bleiben erhalten.
    """

    index = {a.dateiname: a for a in anhaenge}
    angereichert: List[Dokument] = []
    for d in dokumente:
        a = index.get(d.dateiname)
        if a is None:
            angereichert.append(d)
            continue
        angereichert.append(
            d.model_copy(
                update={
                    "pruefsumme_sha256": a.sha256_hex(),
                    "groesse_bytes": a.groesse(),
                }
            )
        )
    return angereichert
