"""ERV (Elektronischer Rechtsverkehr) export toolkit.

Submodules:
    models          — Pydantic domain models (ErvNachricht, Partei, ...)
    xjustiz_builder — Builds XJustiz/webERV-style XML
    advokat_builder — Builds Advokat-compatible Akten-Import XML
    package         — Bundles XML + attachments into ZIP packages
    validation      — XSD validation against shipped schemas
    ai_bridge       — Converts Legal-AI / LexWatch output into ErvNachricht
"""

from .models import (
    ErvNachricht,
    Partei,
    Dokument,
    Kopfdaten,
    Grunddaten,
    Fachdaten,
    Einbringer,
    Gericht,
    AdvokatAkt,
)

__all__ = [
    "ErvNachricht",
    "Partei",
    "Dokument",
    "Kopfdaten",
    "Grunddaten",
    "Fachdaten",
    "Einbringer",
    "Gericht",
    "AdvokatAkt",
]
