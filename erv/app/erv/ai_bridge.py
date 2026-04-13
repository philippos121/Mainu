"""Bridge zwischen dem bestehenden Legal-AI-API-Output und einer
ERV-Nachricht bzw. einem Advokat-Akt.

Die Legal-AI-API (LexWatch / RIS-Tracker) liefert bereits
strukturierte Ergebnisse — etwa zu einer Rechtsänderung oder zu
einer Recherche. Diese Funktionen fassen die AI-Analyse in eine
ERV-taugliche Nachricht zusammen (z.B. einen Schriftsatz-Entwurf).
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

from .models import (
    AdvokatAkt,
    Dokument,
    DokumentTyp,
    ErvNachricht,
    Einbringer,
    Fachdaten,
    Gericht,
    Grunddaten,
    Kopfdaten,
    MimeType,
    NachrichtenArt,
    Partei,
)


def ai_result_to_erv_nachricht(
    *,
    ai_output: Dict[str, Any],
    einbringer: Einbringer,
    gericht: Gericht,
    parteien: Optional[List[Partei]] = None,
    nachrichten_art: NachrichtenArt = NachrichtenArt.SCHRIFTSATZ,
    pdf_dateiname: str = "schriftsatz.pdf",
) -> ErvNachricht:
    """Baut aus einem generischen AI-Output eine ERV-Nachricht.

    Erwartete (optionale) Keys in ``ai_output``:
        - ``betreff`` / ``title``
        - ``freitext`` / ``body`` / ``summary``
        - ``rechtsgebiet``
        - ``ris_referenzen`` (list[str])
        - ``judikatur_referenzen`` (list[str])
        - ``verfahrensgegenstand``
        - ``streitwert_eur``
    """

    betreff = (
        ai_output.get("betreff")
        or ai_output.get("title")
        or "Schriftsatz (AI-generiert)"
    )
    freitext = (
        ai_output.get("freitext")
        or ai_output.get("body")
        or ai_output.get("summary")
    )

    fach = Fachdaten(
        betreff=betreff,
        freitext=freitext,
        rechtsgebiet=ai_output.get("rechtsgebiet"),
        ris_referenzen=list(ai_output.get("ris_referenzen") or []),
        judikatur_referenzen=list(ai_output.get("judikatur_referenzen") or []),
    )

    grund = Grunddaten(
        einbringer=einbringer,
        gericht=gericht,
        parteien=list(parteien or []),
        streitwert_eur=ai_output.get("streitwert_eur"),
        verfahrensgegenstand=ai_output.get("verfahrensgegenstand"),
    )

    kopf = Kopfdaten(
        nachrichten_id=str(uuid.uuid4()),
        nachrichten_art=nachrichten_art,
        erstellt_am=datetime.utcnow(),
    )

    dokumente = [
        Dokument(
            dok_id="D001",
            typ=DokumentTyp.SCHRIFTSATZ,
            dateiname=pdf_dateiname,
            mime_type=MimeType.PDF,
            titel=betreff,
            beschreibung="Aus Legal-AI-Output generierter Schriftsatz-Entwurf",
        )
    ]

    return ErvNachricht(
        kopfdaten=kopf, grunddaten=grund, fachdaten=fach, dokumente=dokumente
    )


def erv_nachricht_to_advokat(nachricht: ErvNachricht) -> AdvokatAkt:
    """Konvertiert eine ERV-Nachricht in einen Advokat-Akt.

    Mappt die Mandantenrolle aus Parteien (erste Kläger/Antragsteller
    gilt als Mandant, erster Beklagter/Antragsgegner als Gegner).
    """

    def _role_first(rolle_substr: str) -> Optional[Partei]:
        for p in nachricht.grunddaten.parteien:
            if rolle_substr.lower() in p.rolle.value.lower():
                return p
        return None

    mandant = _role_first("Kläger") or _role_first("Antragsteller")
    gegner = _role_first("Beklagter") or _role_first("Antragsgegner")

    mandant_name = mandant.name if mandant else "Unbekannter Mandant"
    mandant_vorname = mandant.vorname if mandant else None
    gegner_name = gegner.name if gegner else None
    gegner_vorname = gegner.vorname if gegner else None

    return AdvokatAkt(
        akt_nummer=None,  # von Advokat beim Import vergeben
        akt_bezeichnung=nachricht.fachdaten.betreff,
        mandant_name=mandant_name,
        mandant_vorname=mandant_vorname,
        gegner_name=gegner_name,
        gegner_vorname=gegner_vorname,
        rechtsgebiet=nachricht.fachdaten.rechtsgebiet,
        sachbearbeiter=nachricht.grunddaten.einbringer.anwalt_name,
        eroeffnet_am=nachricht.kopfdaten.erstellt_am.date(),
        streitwert_eur=nachricht.grunddaten.streitwert_eur,
        aktenzeichen_gericht=nachricht.grunddaten.gericht.aktenzeichen,
        gericht=nachricht.grunddaten.gericht,
        parteien=list(nachricht.grunddaten.parteien),
        dokumente=list(nachricht.dokumente),
        notizen=nachricht.fachdaten.freitext,
    )
