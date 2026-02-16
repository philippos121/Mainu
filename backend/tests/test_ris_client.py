"""Tests for RIS API client — parsing, metadata extraction, date handling."""

import json
from datetime import date, datetime, timezone

from app.services.ris_client import (
    _collect_metadata,
    _docs_per_page_str,
    _extract_references,
    _map_date_range_to_im_ris_seit,
    _parse_date,
    parse_ris_response,
)

# ──────────────────────────────────────────────────────────────────
# Realistic v2.6 API response: Metadaten has Technisch/Allgemein/Bundesrecht
# This matches what the actual API returns (confirmed from logs).
# ──────────────────────────────────────────────────────────────────

SAMPLE_V26_RESPONSE = {
    "OgdSearchResult": {
        "Hits": {"#text": "3", "@pageSize": "100", "@pageNumber": "1"},
        "OgdDocumentResults": {
            "OgdDocumentReference": [
                {
                    "Data": {
                        "Metadaten": {
                            "Technisch": {
                                "Dokumentnummer": "NOR40262001",
                                "DokumentUrl": "https://www.ris.bka.gv.at/Dokument.wxe?Abfrage=BrKons&Dokumentnummer=NOR40262001",
                                "Applikation": "BrKons",
                            },
                            "Allgemein": {
                                "Kurztitel": "MeldeG-DVO",
                                "Langtitel": "Verordnung des Bundesministers für Inneres zur Durchführung des Meldegesetzes 1991 (Meldegesetz-Durchführungsverordnung – MeldeG-DVO)",
                                "Typ": "V",
                                "Indexe": "03/04 Innere Angelegenheiten; 01/01 Allgemeines Bürgerrecht",
                                "Schlagworte": "Meldepflicht, Unterkunft, Hauptwohnsitz",
                                "ArtikelParagraphAnlage": "§ 1 Abs. 1",
                            },
                            "Bundesrecht": {
                                "Aenderungsdatum": "2024-06-01T00:00:00",
                                "Inkrafttretensdatum": "2024-07-01T00:00:00",
                                "Aenderung": "BGBl. II Nr. 155/2024",
                                "Kundmachungsorgan": "BGBl. Nr. 468/1991",
                            },
                        },
                    },
                },
                {
                    "Data": {
                        "Metadaten": {
                            "Technisch": {
                                "Dokumentnummer": "NOR40260002",
                                "DokumentUrl": "https://www.ris.bka.gv.at/Dokument.wxe?Abfrage=BrKons&Dokumentnummer=NOR40260002",
                                "Applikation": "BrKons",
                            },
                            "Allgemein": {
                                "Kurztitel": "ABGB",
                                "Langtitel": "Allgemeines bürgerliches Gesetzbuch",
                                "Typ": "BG",
                                "Indexe": "22/01 Zivilrecht",
                                "Schlagworte": "Zivilrecht, Vertragsrecht",
                            },
                            "Bundesrecht": {
                                "Aenderungsdatum": "2023-01-01T00:00:00",
                                "Aenderung": "BGBl. I Nr. 200/2023",
                            },
                        },
                    },
                },
                {
                    "Data": {
                        "Metadaten": {
                            "Technisch": {
                                "Dokumentnummer": "NOR40261003",
                                "DokumentUrl": "https://www.ris.bka.gv.at/Dokument.wxe?Abfrage=BrKons&Dokumentnummer=NOR40261003",
                                "Applikation": "BrKons",
                            },
                            "Allgemein": {
                                "Kurztitel": "StGB",
                                "Langtitel": "Strafgesetzbuch",
                                "Typ": "BG",
                                "Indexe": "21/01 Strafrecht allgemein",
                                "Schlagworte": "Strafrecht, Betrug, Cyberkriminalität",
                            },
                            "Bundesrecht": {
                                "Inkrafttretensdatum": "2024-03-15T00:00:00",
                                "Aenderung": "BGBl. I Nr. 50/2024",
                            },
                        },
                    },
                },
            ]
        },
    }
}

# Legacy format: Metadaten → Bundesrecht → BrKons → {fields}
# (older API format or different Applikation type)
SAMPLE_LEGACY_RESPONSE = {
    "OgdSearchResult": {
        "Hits": {"#text": "1"},
        "OgdDocumentResults": {
            "OgdDocumentReference": {
                "DokumentUrl": "https://example.com/legacy",
                "Data": {
                    "Dokumentnummer": "NOR99990001",
                    "Metadaten": {
                        "Bundesrecht": {
                            "BrKons": {
                                "Kurztitel": "LegacyGesetz",
                                "Langtitel": "Ein Gesetz im Legacy-Format",
                                "Aenderungsdatum": "2025-01-15",
                            }
                        }
                    },
                },
            }
        },
    }
}

# Response with single document (dict instead of list)
SAMPLE_SINGLE_DOC_RESPONSE = {
    "OgdSearchResult": {
        "Hits": {"#text": "1"},
        "OgdDocumentResults": {
            "OgdDocumentReference": {
                "Data": {
                    "Metadaten": {
                        "Technisch": {
                            "Dokumentnummer": "NOR88880001",
                            "DokumentUrl": "https://example.com/single",
                        },
                        "Allgemein": {
                            "Kurztitel": "EinzelGesetz",
                        },
                        "Bundesrecht": {
                            "Aenderungsdatum": "2025-06-01",
                        },
                    },
                },
            }
        },
    }
}

EMPTY_RESPONSE = {
    "OgdSearchResult": {
        "Hits": {"#text": "0"},
        "OgdDocumentResults": {"OgdDocumentReference": []},
    }
}


# ──────────────────────────────────────────────────────────────────
# Tests
# ──────────────────────────────────────────────────────────────────


class TestExtractReferences:
    def test_multiple_docs(self):
        refs = _extract_references(SAMPLE_V26_RESPONSE)
        assert len(refs) == 3

    def test_single_doc_as_dict(self):
        refs = _extract_references(SAMPLE_SINGLE_DOC_RESPONSE)
        assert len(refs) == 1

    def test_empty_response(self):
        refs = _extract_references(EMPTY_RESPONSE)
        assert refs == []

    def test_none_safe(self):
        refs = _extract_references({})
        assert refs == []


class TestCollectMetadata:
    def test_v26_structure(self):
        """Metadaten with Technisch/Allgemein/Bundesrecht sections."""
        meta = SAMPLE_V26_RESPONSE["OgdSearchResult"]["OgdDocumentResults"]["OgdDocumentReference"][0]["Data"]["Metadaten"]
        m = _collect_metadata(meta)
        # From Technisch
        assert m.get("Dokumentnummer") == "NOR40262001"
        # From Allgemein
        assert m.get("Kurztitel") == "MeldeG-DVO"
        assert "Meldepflicht" in m.get("Schlagworte", "")
        # From Bundesrecht (overrides)
        assert m.get("Aenderungsdatum") == "2024-06-01T00:00:00"
        assert m.get("Aenderung") == "BGBl. II Nr. 155/2024"

    def test_legacy_brkons_structure(self):
        """Metadaten → Bundesrecht → BrKons → {fields}"""
        meta = SAMPLE_LEGACY_RESPONSE["OgdSearchResult"]["OgdDocumentResults"]["OgdDocumentReference"]["Data"]["Metadaten"]
        m = _collect_metadata(meta)
        assert m.get("Kurztitel") == "LegacyGesetz"
        assert m.get("Aenderungsdatum") == "2025-01-15"

    def test_direct_fields(self):
        """Metadaten → {fields} directly (flat)"""
        meta = {"Kurztitel": "Direkt", "Aenderungsdatum": "2025-01-01", "Dokumentnummer": "X1"}
        m = _collect_metadata(meta)
        assert m.get("Kurztitel") == "Direkt"
        assert m.get("Dokumentnummer") == "X1"

    def test_empty(self):
        m = _collect_metadata({})
        assert m == {}


class TestParseRisResponse:
    def test_parses_all_v26_docs(self):
        results = parse_ris_response(SAMPLE_V26_RESPONSE, law_source="bundesrecht")
        assert len(results) == 3

    def test_first_doc_fields(self):
        results = parse_ris_response(SAMPLE_V26_RESPONSE, law_source="bundesrecht")
        first = results[0]
        assert first["ris_doc_id"] == "NOR40262001"
        assert "Meldegesetz" in first["title"] or "MeldeG" in first["short_title"]
        assert first["bgbl_number"] == "BGBl. II Nr. 155/2024"
        assert first["law_type"] == "Bundesrecht"
        assert first["document_url"] != ""
        assert first["change_date"] is not None
        assert first["change_date"].year == 2024

    def test_second_doc_old_date(self):
        """ABGB with Aenderungsdatum=2023 should still be parsed."""
        results = parse_ris_response(SAMPLE_V26_RESPONSE, law_source="bundesrecht")
        abgb = results[1]
        assert abgb["ris_doc_id"] == "NOR40260002"
        assert abgb["short_title"] == "ABGB"
        assert abgb["change_date"].year == 2023

    def test_categories_from_schlagworte(self):
        results = parse_ris_response(SAMPLE_V26_RESPONSE, law_source="bundesrecht")
        first = results[0]
        assert "Meldepflicht" in first["categories"]

    def test_index_numbers(self):
        results = parse_ris_response(SAMPLE_V26_RESPONSE, law_source="bundesrecht")
        first = results[0]
        assert len(first["index_numbers"]) >= 1

    def test_single_doc_dict_wrapped(self):
        results = parse_ris_response(SAMPLE_SINGLE_DOC_RESPONSE, law_source="bundesrecht")
        assert len(results) == 1
        assert results[0]["ris_doc_id"] == "NOR88880001"
        assert results[0]["short_title"] == "EinzelGesetz"

    def test_legacy_format(self):
        results = parse_ris_response(SAMPLE_LEGACY_RESPONSE, law_source="bundesrecht")
        assert len(results) == 1
        assert results[0]["short_title"] == "LegacyGesetz"
        assert results[0]["change_date"].year == 2025

    def test_empty_response(self):
        results = parse_ris_response(EMPTY_RESPONSE)
        assert results == []

    def test_content_snippet(self):
        results = parse_ris_response(SAMPLE_V26_RESPONSE, law_source="bundesrecht")
        first = results[0]
        # Typ comes from Allgemein
        assert "Typ: V" in first["content_snippet"]


class TestMapDateRange:
    def test_none(self):
        assert _map_date_range_to_im_ris_seit(None) is None

    def test_today(self):
        assert _map_date_range_to_im_ris_seit(date.today()) == "EinerWoche"

    def test_3_days(self):
        from datetime import timedelta
        d = date.today() - timedelta(days=3)
        assert _map_date_range_to_im_ris_seit(d) == "EinerWoche"

    def test_14_days(self):
        from datetime import timedelta
        d = date.today() - timedelta(days=14)
        assert _map_date_range_to_im_ris_seit(d) == "ZweiWochen"

    def test_90_days(self):
        from datetime import timedelta
        d = date.today() - timedelta(days=90)
        assert _map_date_range_to_im_ris_seit(d) == "DreiMonaten"


class TestDocsPerPageStr:
    def test_100(self):
        assert _docs_per_page_str(100) == "OneHundred"

    def test_50(self):
        assert _docs_per_page_str(50) == "Fifty"

    def test_20(self):
        assert _docs_per_page_str(20) == "Twenty"

    def test_10(self):
        assert _docs_per_page_str(10) == "Ten"

    def test_5_rounds_up_to_ten(self):
        assert _docs_per_page_str(5) == "Ten"

    def test_25_rounds_up_to_fifty(self):
        assert _docs_per_page_str(25) == "Fifty"

    def test_200_caps_at_onehundred(self):
        assert _docs_per_page_str(200) == "OneHundred"


class TestParseDate:
    def test_iso_date(self):
        assert _parse_date("2024-06-01") == datetime(2024, 6, 1, tzinfo=timezone.utc)

    def test_iso_datetime(self):
        assert _parse_date("2024-06-01T12:30:00") == datetime(2024, 6, 1, 12, 30, tzinfo=timezone.utc)

    def test_german_date(self):
        assert _parse_date("01.06.2024") == datetime(2024, 6, 1, tzinfo=timezone.utc)

    def test_empty(self):
        assert _parse_date("") is None
        assert _parse_date(None) is None

    def test_already_datetime(self):
        dt = datetime(2024, 1, 1, tzinfo=timezone.utc)
        assert _parse_date(dt) == dt
