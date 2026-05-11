"""Тесты XLSX-парсера: цвет→тип, жирный→название, merged-ячейки→диапазон пар."""
from __future__ import annotations

import json
import pathlib
from dataclasses import asdict

import jsonschema
import pytest

from schedule_parser.parse_schedule import (
    COLOR_TO_TYPE,
    PAIR_BELLS,
    bells_for_pair,
    build_lessons_from_cell,
    detect_type_from_fill,
    detect_type_for_cell,
    parse_bachelor,
)
from schedule_parser.rich_sheet import (
    CellRun,
    RichCell,
    RichRow,
    csv_rows_to_rich_rows,
    read_local_xlsx,
)

FIXTURES = pathlib.Path(__file__).parent / "fixtures"
SCHEMA = pathlib.Path(__file__).parent.parent / "schema" / "schedule.schema.json"


@pytest.fixture(scope="module")
def schema():
    with SCHEMA.open() as fh:
        return json.load(fh)


# ---------- color → lesson_type ----------

class TestColorMapping:
    @pytest.mark.parametrize("fill,expected", [
        ("FFD9EAD3", "lecture"),
        ("FFFCE5CD", "lab"),
        ("FFC9DAF8", "practice"),
        ("FFFFF2CC", "curator_hour"),
        ("FFD9D2E9", "additional"),
        ("ffd9ead3", "lecture"),            # case-insensitive
        ("D9EAD3", "lecture"),               # 6-symbol hex
        ("00D9EAD3", "lecture"),             # alpha=00
        ("00000000", None),                  # default / transparent
        ("FFFFFFFF", None),                  # пустая белая
        (None, None),
        ("", None),
    ])
    def test_detect_type_from_fill(self, fill, expected):
        assert detect_type_from_fill(fill) == expected

    def test_detect_type_for_cell_prefers_color(self):
        # Цвет лекции — даже если в тексте написано "ЛБ" (по идее не должно случаться),
        # цвет является авторитетным источником.
        cell = RichCell(value="ЛБ Математика", fill="FFD9EAD3",
                        runs=[CellRun(text="ЛБ Математика", bold=True)])
        assert detect_type_for_cell(cell, "ЛБ Математика") == "lecture"

    def test_detect_type_for_cell_falls_back_to_text(self):
        # Цвет не известен → используем текстовый detect_type.
        cell = RichCell(value="ЛК Алгебра", fill="00000000",
                        runs=[CellRun(text="ЛК Алгебра", bold=True)])
        assert detect_type_for_cell(cell, "ЛК Алгебра") == "lecture"


# ---------- bold runs → subject ----------

class TestBoldSubject:
    def _make_cell(self, runs: list[tuple[str, bool]], fill: str | None = None) -> RichCell:
        cell_runs = [CellRun(text=t, bold=b) for t, b in runs]
        return RichCell(value="".join(t for t, _ in runs), runs=cell_runs, fill=fill)

    def test_simple_lecture_uses_bold_subject(self):
        # Реальный пример: жирный предмет → нежирный преподаватель.
        cell = self._make_cell([
            ("Электричество\nи магнетизм\n", True),
            ("ст.пр. РаткевичС.В.", False),
        ], fill="FFD9EAD3")
        out = build_lessons_from_cell(
            lesson_text=cell.value, room_text="117",
            day=1, pair=1, t_start="09:00", t_end="10:25",
            group_id="y1-g1", year=1,
            lesson_cell=cell,
        )
        assert len(out) == 1
        lesson = out[0]
        assert lesson.subject == "Электричество и магнетизм"
        assert lesson.teacher == "ст.пр. РаткевичС.В."
        assert lesson.lesson_type == "lecture"
        assert lesson.rooms == ["117"]

    def test_bold_splits_two_subjects_in_one_cell(self):
        # Две пары в одной ячейке (например, "ЦОС" и "ИАД" в J8 year3).
        cell = self._make_cell([
            ("ЦОС\n", True),
            ("1ПГ/2ПГ нечет/чет\nст.пр. ПолещукН.Н.\n", False),
            ("ИАД\n", True),
            ("3ПГ нечет\nдоц. ЖевнякО.Г.", False),
        ], fill="FFC9DAF8")
        out = build_lessons_from_cell(
            lesson_text=cell.value, room_text="115\n116",
            day=1, pair=1, t_start="09:00", t_end="10:25",
            group_id="y3-g1", year=3,
            lesson_cell=cell,
        )
        assert len(out) == 2
        subjects = {l.subject for l in out}
        assert subjects == {"ЦОС", "ИАД"}
        # Каждая получает свой цвет → practice
        assert all(l.lesson_type == "practice" for l in out)

    def test_date_note_in_bold_is_not_subject(self):
        # "по 01.06" — это жирная нота, не предмет.
        cell = self._make_cell([
            ("по 01.06\nПрикладная электродинамика\n", True),
            ("доц. ДемидчикВ.И.", False),
        ], fill="FFD9EAD3")
        out = build_lessons_from_cell(
            lesson_text=cell.value, room_text="115",
            day=1, pair=1, t_start="09:00", t_end="10:25",
            group_id="y3-g1", year=3,
            lesson_cell=cell,
        )
        assert len(out) == 1
        assert out[0].subject == "Прикладная электродинамика"
        assert out[0].notes is not None and "01.06" in out[0].notes


# ---------- merged cells → pair range ----------

class TestMergedPairs:
    def test_lesson_spanning_two_pairs_yields_range(self):
        """Лекция, занимающая ячейки на 2 пары подряд, → pair_number='1-2',
        time охватывает обе пары."""
        # Минимальная RichSheet с 1 группой и одной "лекцией" в D6, спаниющей D6:D7.
        def cell(v, *, bold=False, fill=None, rowspan=1):
            return RichCell(value=v, runs=[CellRun(text=v, bold=bold)] if v else [],
                            fill=fill, rowspan=rowspan)

        header_rows = [
            RichRow(),  # row 0
            RichRow(),  # row 1
            RichRow(),  # row 2
            RichRow(cells=[cell(""), cell(""), cell(""), cell("ФРФиКТ")]),  # row 3 prog
            RichRow(cells=[                                                 # row 4 groups
                cell("День"), cell("Пара"), cell("Время"),
                cell("Группа 1"),
            ]),
        ]
        # row 5: lesson D6 merged with D7 (rowspan=2)
        row5 = RichRow(cells=[
            cell("Пн"), cell("1"), cell("09:00\n-\n10:25"),
            cell("Электричество\nдоц. Иванов", bold=True, fill="FFD9EAD3", rowspan=2),
        ])
        # row 6: empty D7 (merged into D6), but pair col has 2
        row6 = RichRow(cells=[
            cell(""), cell("2"), cell("10:35\n-\n12:00"),
            cell(""),  # merged → empty
        ])
        rows = header_rows + [row5, row6]
        groups, lessons = parse_bachelor(rows, year=1)
        assert len(lessons) == 1
        l = lessons[0]
        assert l.pair_number == "1-2"
        assert l.time_start == "09:00"
        assert l.time_end == "12:00"
        assert l.lesson_type == "lecture"


# ---------- canonical bell schedule ----------

class TestCanonicalBells:
    @pytest.mark.parametrize("pair,expected", [
        (1, ("09:00", "10:25")),
        (2, ("10:35", "12:00")),
        (3, ("12:10", "13:35")),
        (4, ("14:00", "15:25")),
        (5, ("15:35", "17:00")),
        (6, ("17:20", "18:45")),
        (7, ("18:55", "20:20")),
        (8, ("20:30", "21:55")),
        ("1-2", ("09:00", "12:00")),
        ("3-4", ("12:10", "15:25")),
        ("6-8", ("17:20", "21:55")),
        ("3", ("12:10", "13:35")),
        (None, (None, None)),
        (42, (None, None)),
        ("garbage", (None, None)),
    ])
    def test_bells_for_pair(self, pair, expected):
        assert bells_for_pair(pair) == expected

    def test_year1_uses_canonical_times_not_cell_text(self):
        """В year1 в столбце «Время» стоит устаревшее 80-минутное расписание
        (09:00-10:20), а парсер обязан выдавать каноническое 85-минутное."""
        rows = read_local_xlsx(str(FIXTURES / "year1.xlsx"))
        _, lessons = parse_bachelor(rows, 1)
        # Все занятия с pair=1 должны иметь 09:00-10:25, не 09:00-10:20.
        pair1 = [l for l in lessons if l.pair_number == 1]
        assert pair1, "year 1: нет занятий на 1-й паре"
        assert all(l.time_start == "09:00" and l.time_end == "10:25" for l in pair1), \
            f"year 1: 1-я пара не каноническая: {set((l.time_start, l.time_end) for l in pair1)}"
        # Объединённая «1-2» → 09:00-12:00, не 09:00-11:50.
        combined12 = [l for l in lessons if l.pair_number == "1-2"]
        if combined12:
            assert all(l.time_start == "09:00" and l.time_end == "12:00" for l in combined12)


# ---------- end-to-end on real XLSX fixtures ----------

class TestRealFixtures:
    @pytest.mark.parametrize("year", [1, 2, 3])
    def test_xlsx_fixture_yields_lessons_with_types(self, year, schema):
        rows = read_local_xlsx(str(FIXTURES / f"year{year}.xlsx"))
        groups, lessons = parse_bachelor(rows, year)
        assert groups, f"year {year}: no groups parsed"
        assert lessons, f"year {year}: no lessons parsed"
        # Должны быть и лекции, и хотя бы один из (practice/lab/curator_hour)
        types = {l.lesson_type for l in lessons}
        assert "lecture" in types, f"year {year}: no lecture lessons (types={types})"
        # Все lesson_type должны быть из допустимых значений или None
        allowed = set(COLOR_TO_TYPE.values()) | {None}
        # Текстовый detect_type тоже может прибавить seminar/exam/consult — но не для бакалавриата.
        for l in lessons:
            assert l.lesson_type in allowed | {"seminar", "exam", "consult"}, \
                f"unexpected lesson_type {l.lesson_type!r}"
        # Должна быть хотя бы одна объединённая пара ("X-Y")
        combined = [l for l in lessons if isinstance(l.pair_number, str)]
        assert combined, f"year {year}: no combined-pair lessons detected"
        for l in combined:
            assert "-" in l.pair_number
            a, b = l.pair_number.split("-", 1)
            assert a.isdigit() and b.isdigit() and int(b) > int(a)
        # JSON-schema валидация мини-датасета
        data = {
            "academic_year": "2025-2026",
            "faculty": "ФРФиКТ",
            "semester": 2,
            "form": "очная",
            "generated_at": "2025-01-01T00:00:00Z",
            "source": {"type": "google_sheets", "sheets": []},
            "groups": [asdict(g) for g in groups],
            "lessons": [asdict(l) for l in lessons],
        }
        jsonschema.validate(data, schema)

    def test_year3_detects_additional_color(self):
        """Year 3 содержит ячейки с цветом 'ДО' (D9D2E9) — фиолетовый."""
        rows = read_local_xlsx(str(FIXTURES / "year3.xlsx"))
        _, lessons = parse_bachelor(rows, 3)
        additional = [l for l in lessons if l.lesson_type == "additional"]
        assert additional, "ожидаются занятия с типом 'additional' (цвет ДО)"

    def test_csv_path_still_works_without_formatting(self):
        """Старый CSV-путь не должен ломаться: lesson_type=None, всё валидно."""
        from schedule_parser.parse_schedule import read_local_csv
        rows = read_local_csv(str(FIXTURES / "year3.csv"))
        groups, lessons = parse_bachelor(rows, 3)
        assert groups and lessons
        # Без цветов все типы должны быть None (или прилетевшие из текста).
        # Текст в реальных таблицах бакалавриата не содержит ЛК/ЛБ/ПЗ → ожидаем None.
        non_none_types = [l for l in lessons if l.lesson_type is not None]
        assert len(non_none_types) == 0, (
            f"CSV-путь не должен ставить тип; нашли: {[(l.subject, l.lesson_type) for l in non_none_types[:5]]}"
        )
