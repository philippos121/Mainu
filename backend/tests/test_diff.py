"""Tests for RIS client and diff service logic.

Run with: python -m pytest tests/ -v
"""
import pytest
import sys
import os

# Add backend to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from app.services.ris_client import (
    _is_expired_before,
    _date_before,
    _dedup_provisions,
    parse_bundesrecht_response,
)
from app.services.diff_service import (
    _dedup_accessible,
    _remove_sentence_dupes,
    _clean,
    _word_diff,
)


# ── Filter: superseded before taking effect ──

class TestDateBefore:
    def test_ausserkraft_before_inkraft(self):
        """§ 1159: Ausserkraft 30.06.2025 < Inkraft 01.01.2026 → skip"""
        assert _date_before("2025-06-30", "2026-01-01") is True
        assert _date_before("30.06.2025", "01.01.2026") is True

    def test_ausserkraft_after_inkraft(self):
        assert _date_before("2028-06-30", "2025-07-01") is False

    def test_same_date(self):
        assert _date_before("2026-01-01", "2026-01-01") is False

    def test_empty(self):
        assert _date_before("", "2026-01-01") is False
        assert _date_before("2025-06-30", "") is False


# ── Filter: expired before timeframe ──

class TestExpiredBefore:
    def test_expired_long_ago(self):
        """§ 181 ABGB expired 2013 — always skip"""
        assert _is_expired_before("31.01.2013", 366) is True
        assert _is_expired_before("2013-01-31", 366) is True

    def test_expired_within_year(self):
        """§ 246 ABGB expired 30.06.2025 — show within 1 year, skip within 1 month"""
        # Within 1 year: should NOT be filtered (expired recently)
        assert _is_expired_before("30.06.2025", 366) is False
        # Within 1 month: should be filtered (expired 9 months ago)
        assert _is_expired_before("30.06.2025", 31) is True

    def test_no_expiry(self):
        assert _is_expired_before("", 366) is False
        assert _is_expired_before("9999-12-31", 366) is False

    def test_future(self):
        assert _is_expired_before("30.06.2028", 366) is False


# ── Deduplication of superseded provisions ──

class TestDedup:
    def test_removes_old_when_new_exists(self):
        """§ 275: old (2018, expired 2025) + new (2025) → keep only new"""
        results = [
            {"id": "OLD", "gesetzesnummer": "10001622", "artikel": "§ 275",
             "date": "2018-07-01", "ausserkraft": "2025-06-30"},
            {"id": "NEW", "gesetzesnummer": "10001622", "artikel": "§ 275",
             "date": "2025-07-01", "ausserkraft": ""},
        ]
        deduped = _dedup_provisions(results)
        ids = [r["id"] for r in deduped]
        assert "OLD" not in ids
        assert "NEW" in ids

    def test_keeps_unrelated(self):
        results = [
            {"id": "A", "gesetzesnummer": "10001720", "artikel": "§ 30g",
             "date": "2026-02-19", "ausserkraft": ""},
        ]
        assert len(_dedup_provisions(results)) == 1

    def test_keeps_single_expired(self):
        """Single expired provision (no newer version) stays"""
        results = [
            {"id": "A", "gesetzesnummer": "10001622", "artikel": "§ 246",
             "date": "2018-07-01", "ausserkraft": "2025-06-30"},
        ]
        assert len(_dedup_provisions(results)) == 1


# ── Accessible text duplicate removal ──

class TestAccessibleDupes:
    def test_removes_paragraph_duplicate(self):
        text = "§ 181. Paragraph 181, (1) Text here."
        result = _dedup_accessible(text)
        assert "Paragraph 181" not in result
        assert "§ 181." in result

    def test_removes_absatz_duplicate(self):
        text = "(2) Absatz 2, Some text. (3) Absatz drei, More text."
        result = _dedup_accessible(text)
        assert "Absatz 2" not in result
        assert "Absatz drei" not in result
        assert "(2)" in result
        assert "(3)" in result

    def test_removes_sentence_level_duplicates(self):
        """The core problem: entire sentences duplicated with refs stripped"""
        text = (
            "(2) Das Zustimmungsrecht nach Abs. 1 entfällt, wenn die Person "
            "den Vertrag geschlossen hat. "
            "Das Zustimmungsrecht nach entfällt, wenn die Person "
            "den Vertrag geschlossen hat."
        )
        result = _dedup_accessible(text)
        assert result.count("Das Zustimmungsrecht") == 1

    def test_removes_bgbl_accessible_duplicate(self):
        """BGBl references get doubled: original + 'Bundesgesetzblatt' version"""
        text = (
            "im Sinne des § 53 Abs. 6 des Arbeitsverfassungsgesetzes, "
            "BGBl. Nr. 22/1974 überwiegen. "
            "im Sinne des des Arbeitsverfassungsgesetzes, "
            "Bundesgesetzblatt Nr. 22 aus 1974, überwiegen."
        )
        result = _dedup_accessible(text)
        assert result.count("überwiegen") == 1

    def test_removes_html_artifact(self):
        text = 'Some text. <div id="MainContent_DocumentRepeater_BundesnormenDocumentData_0_'
        result = _dedup_accessible(text)
        assert "<div" not in result

    def test_removes_im_ris_seit(self):
        """'Im RIS seit' metadata should not appear in legal text"""
        text = "Some legal text. Im RIS seit 02.05.2017"
        # This is a text extraction issue, not dedup - but check it doesn't break
        result = _dedup_accessible(text)
        assert "Some legal text" in result


# ── HTML cleaning ──

class TestClean:
    def test_strips_gld_spans(self):
        html = '<span>§ 53 Abs. 6</span><span class="GldPar">Paragraph 53,</span><span class="GldAbs">Absatz 6,</span>'
        result = _clean(html)
        assert "§ 53 Abs. 6" in result
        assert "Paragraph 53" not in result
        assert "Absatz 6," not in result

    def test_strips_screereader(self):
        html = '<span>Normal</span><span class="ScreenReaderText">Duplicate</span>'
        result = _clean(html)
        assert "Normal" in result
        assert "Duplicate" not in result

    def test_strips_main_content_div(self):
        html = 'Text<div id="MainContent_Foo_0_Bar">artifact'
        result = _clean(html)
        assert "Text" in result
        # The div is stripped but "artifact" may remain as text


# ── Word diff ──

class TestWordDiff:
    def test_side_by_side_for_rewrite(self):
        old = "This is a completely different text about something else entirely."
        new = "New provision about a totally unrelated legal matter with different words."
        result = _word_diff(old, new)
        assert "diff-sidebyside" in result
        assert "Vorversion" in result
        assert "Neue Fassung" in result

    def test_inline_for_small_change(self):
        old = "Die Frist beträgt drei Jahre."
        new = "Die Frist beträgt fünf Jahre."
        result = _word_diff(old, new)
        assert "diff-del" in result
        assert "diff-ins" in result
        assert "drei" in result
        assert "fünf" in result
        assert "diff-sidebyside" not in result


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
