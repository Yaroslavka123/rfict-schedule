"""Тесты дискавери таблиц с rct.bsu.by на сохранённом HTML-фикстуре."""
from __future__ import annotations

import pathlib
from unittest.mock import patch

from schedule_parser.discover_sheets import discover, classify

FIXTURE_HTML = (pathlib.Path(__file__).parent / "fixtures" / "rct.html").read_text(encoding="utf-8")


class TestClassify:
    def test_bachelor_first_course(self):
        c = classify("1 курс расписание")
        assert c == {"year": 1, "kind": "bachelor", "label": "Бакалавриат 1 курс"}

    def test_bachelor_third(self):
        c = classify("3 курс расписание")
        assert c["year"] == 3 and c["kind"] == "bachelor"

    def test_master_ru(self):
        c = classify("Расписание занятий 1 курс 2 семестр (магистратура)")
        assert c["year"] == 4 and c["kind"] == "master_ru"

    def test_master_en(self):
        c = classify("Расписание занятий 1 курс 2 семестр 7-06-0533-08 Cybersecurity")
        assert c["year"] == 4 and c["kind"] == "master_en"

    def test_unknown(self):
        assert classify("Шаблон") is None


class TestDiscover:
    def test_discover_returns_five_sheets(self):
        with patch("schedule_parser.discover_sheets.fetch", return_value=FIXTURE_HTML):
            sheets = discover()
        assert len(sheets) == 5
        # все 5 уникальны
        ids = {(s["year"], s["kind"]) for s in sheets}
        assert ids == {
            (1, "bachelor"),
            (2, "bachelor"),
            (3, "bachelor"),
            (4, "master_ru"),
            (4, "master_en"),
        }

    def test_discover_extracts_ids(self):
        with patch("schedule_parser.discover_sheets.fetch", return_value=FIXTURE_HTML):
            sheets = discover()
        for s in sheets:
            assert len(s["sheet_id"]) > 20
            assert s["gid"].isdigit()
            assert s["csv_url"].startswith("https://docs.google.com/")
