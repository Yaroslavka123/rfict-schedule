"""Тесты парсера расписания на фиксированных CSV-фикстурах."""
from __future__ import annotations

import json
import os
import pathlib

import jsonschema
import pytest

from schedule_parser.parse_schedule import (
    build_dataset,
    parse_bachelor,
    parse_master,
    parse_day,
    parse_time_range,
    extract_subgroup,
    extract_weeks,
    hash_id,
    read_local_csv,
    parse_master_rooms,
    parse_master_teacher,
    parse_master_subject,
)

FIXTURES = pathlib.Path(__file__).parent / "fixtures"
SCHEMA = pathlib.Path(__file__).parent.parent / "schema" / "schedule.schema.json"


# ---------- unit ----------

class TestHelpers:
    @pytest.mark.parametrize("text,expected", [
        ("Пн", 1), ("понедельник", 1), ("Monday", 1),
        ("Суббота(Saturday)", 6),
        ("", None), ("abc", None),
    ])
    def test_parse_day(self, text, expected):
        assert parse_day(text) == expected

    @pytest.mark.parametrize("text,expected", [
        ("09:00\n-\n10:25", ("09:00", "10:25")),
        ("9:00-10:25", ("09:00", "10:25")),
        ("", (None, None)),
    ])
    def test_parse_time_range(self, text, expected):
        assert parse_time_range(text) == expected

    def test_extract_subgroup(self):
        assert extract_subgroup("1 ПГ/2ПГ чет") == "1ПГ/2ПГ"
        assert extract_subgroup("Алгебра") is None

    @pytest.mark.parametrize("text,expected", [
        ("чет/нечет", "all"),
        ("нечет", "odd"),
        ("чет", "even"),
        ("обычная пара", "all"),
    ])
    def test_extract_weeks(self, text, expected):
        assert extract_weeks(text) == expected

    def test_hash_id_deterministic(self):
        assert hash_id("a", "b") == hash_id("a", "b")
        assert hash_id("a", "b") != hash_id("b", "a")


class TestMasterHelpers:
    def test_rooms_aud(self):
        assert parse_master_rooms("ЛК - 04.05 ауд. 519 ул.Курчатова,7") == ["519"]

    def test_rooms_ikt(self):
        assert "ИКТ" in parse_master_rooms("ЛБ - 25.05 ИКТ Методики...")

    def test_rooms_english(self):
        rooms = parse_master_rooms("LB - 04.05 room 505 Virtualization")
        assert "505" in rooms

    def test_teacher(self):
        assert parse_master_teacher("деятельности, Леонтьев А.В.") == "Леонтьев А.В."
        assert parse_master_teacher("Trukhanovich Alexsei L.") == "Trukhanovich Alexsei L."

    def test_subject(self):
        subj = parse_master_subject(
            "11.05-01.06 ИКТ  Методики планирования и проведения научной деятельности, Леонтьев А.В.",
            rooms=["ИКТ"],
            teacher="Леонтьев А.В.",
        )
        assert "Методики" in subj
        assert "Леонтьев" not in subj


# ---------- integration ----------

class TestBachelor:
    @pytest.fixture(scope="class")
    def year1(self):
        rows = read_local_csv(str(FIXTURES / "year1.csv"))
        return parse_bachelor(rows, 1)

    def test_groups_count(self, year1):
        groups, _ = year1
        assert len(groups) == 10
        ids = {g.id for g in groups}
        assert "y1-g1" in ids
        assert "y1-g10" in ids

    def test_lessons_not_empty(self, year1):
        _, lessons = year1
        assert len(lessons) > 100

    def test_lesson_fields(self, year1):
        _, lessons = year1
        l0 = lessons[0]
        assert l0.day_of_week >= 1
        assert l0.time_start < l0.time_end
        assert l0.subject
        assert l0.raw

    def test_all_days_present(self, year1):
        _, lessons = year1
        days = {l.day_of_week for l in lessons}
        assert 1 in days  # Пн
        assert 6 in days  # Сб


class TestMaster:
    @pytest.fixture(scope="class")
    def master_ru(self):
        rows = read_local_csv(str(FIXTURES / "year4_ru.csv"))
        return parse_master(rows, 4, "ru")

    def test_groups_found(self, master_ru):
        groups, _ = master_ru
        assert len(groups) >= 2

    def test_lessons_not_empty(self, master_ru):
        _, lessons = master_ru
        assert len(lessons) > 20


class TestYear2:
    @pytest.fixture(scope="class")
    def year2(self):
        rows = read_local_csv(str(FIXTURES / "year2.csv"))
        return parse_bachelor(rows, 2)

    def test_groups_count(self, year2):
        groups, _ = year2
        assert len(groups) == 10

    def test_lessons_not_empty(self, year2):
        _, lessons = year2
        assert len(lessons) > 100


class TestYear3:
    @pytest.fixture(scope="class")
    def year3(self):
        rows = read_local_csv(str(FIXTURES / "year3.csv"))
        return parse_bachelor(rows, 3)

    def test_groups_count(self, year3):
        groups, _ = year3
        assert len(groups) >= 7

    def test_lessons_not_empty(self, year3):
        _, lessons = year3
        assert len(lessons) > 100


class TestFullBuild:
    @pytest.fixture(scope="class")
    def dataset(self):
        sheets = [
            {"year": 1, "id": "", "gid": "", "kind": "bachelor", "semester": 2},
            {"year": 2, "id": "", "gid": "", "kind": "bachelor", "semester": 4},
            {"year": 3, "id": "", "gid": "", "kind": "bachelor", "semester": 6},
            {"year": 4, "id": "", "gid": "", "kind": "master_ru", "semester": 2},
            {"year": 4, "id": "", "gid": "", "kind": "master_en", "semester": 2},
        ]
        return build_dataset(use_local=True, local_dir=str(FIXTURES), sheets=sheets)

    def test_schema_valid(self, dataset):
        schema = json.loads(SCHEMA.read_text(encoding="utf-8"))
        jsonschema.validate(dataset, schema)

    def test_groups(self, dataset):
        assert len(dataset["groups"]) >= 30

    def test_lessons(self, dataset):
        assert len(dataset["lessons"]) >= 500

    def test_has_all_years(self, dataset):
        years = {g["year"] for g in dataset["groups"]}
        assert years == {1, 2, 3, 4}

    def test_generated_at(self, dataset):
        assert "T" in dataset["generated_at"]
