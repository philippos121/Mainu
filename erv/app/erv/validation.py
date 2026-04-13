"""XSD-Validierung für ERV- und Advokat-XML."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional

from lxml import etree


SCHEMAS_DIR = Path(__file__).resolve().parent.parent.parent / "schemas"
ERV_XSD = SCHEMAS_DIR / "erv-nachricht-1.0.xsd"
ADVOKAT_XSD = SCHEMAS_DIR / "advokat-import-1.0.xsd"


@dataclass
class ValidationResult:
    valid: bool
    fehler: List[str]
    schema: str

    def to_dict(self) -> dict:
        return {"valid": self.valid, "schema": self.schema, "fehler": self.fehler}


def _load_schema(path: Path) -> etree.XMLSchema:
    with path.open("rb") as f:
        doc = etree.parse(f)
    return etree.XMLSchema(doc)


def validate_xml(xml_bytes: bytes, schema_path: Path) -> ValidationResult:
    schema = _load_schema(schema_path)
    try:
        doc = etree.fromstring(xml_bytes)
    except etree.XMLSyntaxError as e:
        return ValidationResult(False, [f"XMLSyntaxError: {e}"], schema_path.name)

    ok = schema.validate(doc)
    fehler = [f"{err.line}:{err.column}: {err.message}" for err in schema.error_log]
    return ValidationResult(ok, fehler, schema_path.name)


def validate_erv(xml_bytes: bytes) -> ValidationResult:
    return validate_xml(xml_bytes, ERV_XSD)


def validate_advokat(xml_bytes: bytes) -> ValidationResult:
    return validate_xml(xml_bytes, ADVOKAT_XSD)


def detect_and_validate(xml_bytes: bytes) -> ValidationResult:
    """Erkennt anhand des Root-Namespace, welches Schema anzuwenden ist."""
    try:
        doc = etree.fromstring(xml_bytes)
    except etree.XMLSyntaxError as e:
        return ValidationResult(False, [f"XMLSyntaxError: {e}"], "unknown")

    ns = etree.QName(doc.tag).namespace or ""
    if "edikte.justiz.gv.at/erv" in ns:
        return validate_erv(xml_bytes)
    if "advokat.at" in ns:
        return validate_advokat(xml_bytes)
    return ValidationResult(
        False,
        [f"Unbekannter Namespace: {ns!r}. Erwartet ERV oder Advokat."],
        "unknown",
    )


def available_schemas() -> dict:
    """Gibt die mitgelieferten XSD-Dateien als Text zurück."""
    return {
        "erv-nachricht-1.0.xsd": ERV_XSD.read_text(encoding="utf-8"),
        "advokat-import-1.0.xsd": ADVOKAT_XSD.read_text(encoding="utf-8"),
    }
