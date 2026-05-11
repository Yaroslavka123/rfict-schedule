"""
Парсер расписания ФРФиКТ из Google Sheets в JSON.

Использование:
    python parse_schedule.py --out schedule.json

Скрипт качает 5 CSV-листов (1-3 курсы + 4 курс RU/EN) напрямую через
publish-to-web export URL, парсит их и собирает в один JSON.

Схема результата описана в schedule.schema.json.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import os
import re
import sys
import urllib.request
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Iterable

from schedule_parser.rich_sheet import (
    CellRun,
    RichCell,
    RichRow,
    csv_rows_to_rich_rows,
    fetch_xlsx_rich_rows,
    read_local_xlsx,
)

SHEETS = [
    {"year": 1, "semester": 2, "id": "1Wmsij8rOJAcOaPaKWnUphEghdldCRvXDqvX7am6Km4A", "gid": "1900569018", "kind": "bachelor"},
    {"year": 2, "semester": 4, "id": "11LI8TxCfm8zyniVfH4gCaEzzgpTlSqHWeDob5sprBxw", "gid": "1611333238", "kind": "bachelor"},
    {"year": 3, "semester": 6, "id": "1itE56-6GQvK2MvNBBtos2O7sGFGD0pC7zpWM4CV2OnU", "gid": "541681112",  "kind": "bachelor"},
    {"year": 4, "semester": 2, "id": "1t_K6D8claz1NIq8NEGKNRZLJeIqcIp8WCgco9gZuIVk", "gid": "0",          "kind": "master_ru"},
    {"year": 4, "semester": 2, "id": "17wEY5DKKRjZnIhs5voqUew7CsgjwfIQORSoDSvTUqqM", "gid": "0",          "kind": "master_en"},
]

DAY_MAP = {
    "пн": 1, "понедельник": 1, "monday": 1,
    "вт": 2, "вторник": 2, "tuesday": 2,
    "ср": 3, "среда": 3, "wednesday": 3,
    "чт": 4, "четверг": 4, "thursday": 4,
    "пт": 5, "пятница": 5, "friday": 5,
    "сб": 6, "суббота": 6, "saturday": 6,
    "вс": 7, "воскресенье": 7, "sunday": 7,
}

TYPE_MAP = {
    "ЛК": "lecture",
    "Лк": "lecture",
    "Лекция": "lecture",
    "Lecture": "lecture",
    "LK": "lecture",
    "ЛБ": "lab",
    "Лб": "lab",
    "LB": "lab",
    "Семинар": "seminar",
    "Seminar": "seminar",
    "ПЗ": "practice",
    "Практика": "practice",
}

# Цвета заливки ячеек в реальных таблицах rct.bsu.by (Google Sheets XLSX-export).
# Хранятся как 8-символьные ARGB-hex без префикса '#'.
#   D9EAD3 (светло-зелёный)  → лекция
#   FCE5CD (светло-оранжевый)→ лабораторная
#   C9DAF8 (светло-синий)    → практическое занятие
#   FFF2CC (светло-жёлтый)   → кураторский час
#   D9D2E9 (светло-фиолет.)  → ДО (дополнительное занятие на отдельные даты)
COLOR_TO_TYPE: dict[str, str] = {
    "FFD9EAD3": "lecture",
    "FFFCE5CD": "lab",
    "FFC9DAF8": "practice",
    "FFFFF2CC": "curator_hour",
    "FFD9D2E9": "additional",
}

# Каноническое расписание звонков ФРФиКТ (85-минутные пары + перерывы).
# Время в столбце «Время» в таблицах year1/year2 — устаревшее 80-минутное, потому
# мы детерминированно подменяем его по номеру пары. Для магистратуры pair_number=None,
# и подмена не срабатывает — там остаётся время из ячейки.
PAIR_BELLS: dict[int, tuple[str, str]] = {
    1: ("09:00", "10:25"),
    2: ("10:35", "12:00"),
    3: ("12:10", "13:35"),
    4: ("14:00", "15:25"),
    5: ("15:35", "17:00"),
    6: ("17:20", "18:45"),
    7: ("18:55", "20:20"),
    8: ("20:30", "21:55"),
}


def bells_for_pair(pair: int | str | None) -> tuple[str | None, str | None]:
    """Каноническое время для пары или диапазона пар.

    pair=3        → ("12:10", "13:35")
    pair="3-4"    → ("12:10", "15:25")  — от начала первой до конца последней
    pair=None     → (None, None)
    pair=42       → (None, None)        — за пределами 1..8
    """
    if pair is None:
        return (None, None)
    if isinstance(pair, int):
        return PAIR_BELLS.get(pair, (None, None))
    s = str(pair).strip()
    if s.isdigit():
        return PAIR_BELLS.get(int(s), (None, None))
    m = re.match(r"^(\d+)\s*-\s*(\d+)$", s)
    if not m:
        return (None, None)
    a, b = int(m.group(1)), int(m.group(2))
    if a not in PAIR_BELLS or b not in PAIR_BELLS:
        return (None, None)
    return (PAIR_BELLS[a][0], PAIR_BELLS[b][1])


def detect_type_from_fill(fill: str | None) -> str | None:
    """Определить тип занятия по цвету заливки ячейки.

    Сравнение нечувствительно к регистру; принимает 6- или 8-символьный hex
    (с/без альфа-канала). Неизвестные цвета → None.
    """
    if not fill or not isinstance(fill, str):
        return None
    f = fill.upper()
    if f in COLOR_TO_TYPE:
        return COLOR_TO_TYPE[f]
    # Принять также 6-символьный hex без альфы.
    if len(f) == 6:
        return COLOR_TO_TYPE.get("FF" + f)
    if len(f) == 8:
        return COLOR_TO_TYPE.get("FF" + f[2:])
    return None

TIME_RE = re.compile(r"(\d{1,2}):(\d{2})")
DATE_RANGE_RE = re.compile(r"(\d{1,2}\.\d{1,2})(?:\s*[-–]\s*(\d{1,2}\.\d{1,2}))?")


# ---------- helpers ----------

def fetch_csv(sheet_id: str, gid: str) -> list[list[str]]:
    url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=csv&gid={gid}"
    with urllib.request.urlopen(url) as resp:
        data = resp.read().decode("utf-8")
    return list(csv.reader(io.StringIO(data)))


def read_local_csv(path: str) -> list[list[str]]:
    with open(path, encoding="utf-8") as fh:
        return list(csv.reader(fh))


def hash_id(*parts: str) -> str:
    return hashlib.sha1("|".join(parts).encode("utf-8")).hexdigest()[:12]


def parse_day(value: str) -> int | None:
    v = (value or "").strip().lower()
    # стрипнуть параллельные переводы: "Понедельник(Monday)"
    v = re.sub(r"\s*\(.+?\)\s*", "", v).strip()
    return DAY_MAP.get(v)


def parse_time_range(value: str) -> tuple[str | None, str | None]:
    if not value:
        return None, None
    times = TIME_RE.findall(value)
    if len(times) >= 2:
        return f"{int(times[0][0]):02d}:{times[0][1]}", f"{int(times[1][0]):02d}:{times[1][1]}"
    if len(times) == 1:
        return f"{int(times[0][0]):02d}:{times[0][1]}", None
    return None, None


def clean_lines(text: str) -> list[str]:
    return [ln.strip() for ln in (text or "").splitlines() if ln.strip()]


def detect_type(text: str) -> str | None:
    for key, val in TYPE_MAP.items():
        if re.search(rf"\b{re.escape(key)}\b", text):
            return val
    return None


def detect_type_for_cell(cell: RichCell | None, text: str) -> str | None:
    """Тип занятия: сначала по цвету заливки, fallback — по тексту."""
    if cell is not None:
        by_color = detect_type_from_fill(cell.fill)
        if by_color is not None:
            return by_color
    return detect_type(text or "")


def extract_subgroup(text: str) -> str | None:
    m = re.search(r"\d\s*ПГ(?:\s*/\s*\d\s*ПГ)?", text)
    return m.group(0).replace(" ", "") if m else None


def extract_weeks(text: str) -> str:
    t = text.lower()
    if "чет/нечет" in t or "нечет/чет" in t:
        return "all"
    if "нечет" in t:
        return "odd"
    if "чет" in t:
        return "even"
    return "all"


# Префиксы должностей преподавателей. Порядок важен — длинные ДО коротких,
# иначе "ст.пр." поймается как "ст.".
_TEACHER_PREFIXES = (
    "ст. пр.", "ст.пр.", "пр.ст.", "проф.", "доц.", "асс.", "преп.", "пр.", "ст.",
)
_INITIALS_RE = re.compile(r"[А-Яа-яA-Za-z]\.\s*[А-Яа-яA-Za-z]?\.?")


def is_teacher_line(line: str) -> bool:
    """Строка вида 'ст.пр. ШалатонинИ.А.' / 'пр. БурковскаяА.И.' / 'проф. Гайдук П.И.'"""
    s = (line or "").strip()
    if not s or len(s) > 120:
        return False
    low = s.lower()
    matched = False
    for p in _TEACHER_PREFIXES:
        if low.startswith(p):
            matched = True
            break
    if not matched:
        return False
    # Должны быть инициалы (иначе "ст. курс" / "пр. ст. ..." поймаются)
    return bool(_INITIALS_RE.search(s))


def is_subgroup_only_line(line: str) -> bool:
    """Строки типа '3ПГ/4ПГ нечет/чет', '1 ПГ', '3 ПГ чет' — без названия предмета.
    Признак: начинается с цифры+ПГ И не содержит длинного слова с заглавной."""
    s = (line or "").strip()
    if not s or len(s) > 40:
        return False
    if not re.match(r"^\d\s*ПГ", s):
        return False
    # Если внутри есть капитализированное слово (предмет, преподаватель) — это не «чистая» подгруппа
    return not re.search(r"[А-ЯA-Z][а-яa-z]{3,}", s)


def is_note_line(line: str) -> bool:
    """Строки-пометки: 'с 16.02', 'по 21.05', 'на 11.05', 'доп. занятие'."""
    s = (line or "").strip().lower()
    if not s:
        return False
    return bool(re.match(
        r"^(по\s+\d|с\s+\d|до\s+\d|на\s+\d|отмен|отработк|доп[\.\s]|с\s+1[0-9][.:]\d)",
        s,
    ))


_LEADING_SUBGROUP_RE = re.compile(r"^\s*\d\s*ПГ(?:\s*/\s*\d\s*ПГ)*\s*")


def strip_leading_subgroup_marker(line: str) -> str:
    """'2ПГАнглийский язык' → 'Английский язык'. Удаляет ведущий '<n>ПГ' если за ним идёт текст."""
    s = (line or "").strip()
    m = _LEADING_SUBGROUP_RE.match(s)
    if m and m.end() < len(s) and s[m.end()].isalpha():
        return s[m.end():].strip()
    return s


def parse_date(token: str, year: int = 2026) -> str | None:
    m = re.fullmatch(r"(\d{1,2})\.(\d{1,2})", token)
    if not m:
        return None
    d, mo = int(m.group(1)), int(m.group(2))
    return f"{year:04d}-{mo:02d}-{d:02d}"


def extract_date_range(text: str) -> tuple[str | None, str | None]:
    m = DATE_RANGE_RE.search(text)
    if not m:
        return None, None
    return parse_date(m.group(1)), parse_date(m.group(2)) if m.group(2) else None


# ---------- bachelor (years 1-3) ----------

@dataclass
class Group:
    id: str
    year: int
    number: object
    program_code: str | None = None
    program_name: str | None = None
    language: str = "ru"


@dataclass
class Lesson:
    id: str
    group_ids: list[str]
    day_of_week: int
    # pair_number — или целое ("3"), или строка-диапазон ("3-4") для объединённых
    # пар. None — когда номер пары недоступен (расписание магистратуры).
    pair_number: int | str | None
    time_start: str
    time_end: str
    subject: str
    lesson_type: str | None
    teacher: str | None
    rooms: list[str]
    subgroup: str | None
    weeks: str
    date_from: str | None
    date_to: str | None
    notes: str | None
    raw: str


def _as_rich_rows(rows: list[list[str]] | list[RichRow]) -> list[RichRow]:
    """Принять либо "сырые" CSV-строки, либо уже RichRow."""
    if not rows:
        return []
    if isinstance(rows[0], RichRow):
        return rows  # type: ignore[return-value]
    return csv_rows_to_rich_rows(rows)  # type: ignore[arg-type]


def _pair_number_from_cell(text: str) -> int | None:
    """Парсит номер пары из ячейки: '1', '1.0', '01' → 1."""
    s = (text or "").strip()
    if not s:
        return None
    m = re.match(r"^(\d+)(?:\.\d+)?$", s)
    if m:
        try:
            return int(m.group(1))
        except ValueError:
            return None
    return None


def parse_bachelor(
    rows: list[list[str]] | list[RichRow],
    year: int,
) -> tuple[list[Group], list[Lesson]]:
    """Парсит листы 1-3 курса (одинаковая структура).

    Принимает или плоские CSV-строки (без форматирования), или RichRow из
    XLSX-экспорта (с цветом, жирным шрифтом, merged-диапазонами).
    """
    rich_rows = _as_rich_rows(rows)
    if len(rich_rows) < 5:
        return [], []

    # ряд с программой — row 3, ряд с группами — row 4
    prog_row = rich_rows[3]
    grp_row = rich_rows[4]
    n_cols = max(len(r.cells) for r in rich_rows)

    # колонки с группами: где в grp_row начинается «Группа …»
    group_cols: list[tuple[int, str, str | None, str | None]] = []
    last_prog = None
    for col in range(n_cols):
        prog_cell = prog_row.value(col)
        if prog_cell.strip():
            last_prog = prog_cell.strip()
        cell_val = grp_row.value(col)
        m = re.match(r"\s*Группа\s+(\S+)\s*\n?(.*)", cell_val or "", re.DOTALL)
        if m:
            number = m.group(1).strip()
            program_name = m.group(2).strip() or None
            group_cols.append((col, number, last_prog, program_name))

    groups = [
        Group(
            id=f"y{year}-g{num}",
            year=year,
            number=int(num) if num.isdigit() else num,
            program_code=prog,
            program_name=program_name,
        )
        for col, num, prog, program_name in group_cols
    ]

    lessons: list[Lesson] = []
    current_day: int | None = None
    n_rows = len(rich_rows)
    for r_idx in range(5, n_rows):
        row = rich_rows[r_idx]
        if not any((c.value or "").strip() for c in row.cells):
            continue
        day_cell = row.value(0)
        pair_cell = row.value(1)
        time_cell = row.value(2)
        d = parse_day(day_cell)
        if d:
            current_day = d
        if current_day is None:
            continue
        pair_number_int = _pair_number_from_cell(pair_cell)
        # Время в исходной ячейке используем только как фолбэк, если по номеру
        # пары не нашлось канонической записи в PAIR_BELLS.
        cell_t_start, cell_t_end = parse_time_range(time_cell)
        if pair_number_int is None and not (cell_t_start and cell_t_end):
            continue

        for col, num, prog, _ in group_cols:
            lesson_cell = row.cell(col)
            room_cell = row.cell(col + 1)
            lesson_text = lesson_cell.value
            room_text = room_cell.value
            if not (lesson_text or "").strip():
                continue

            # Объединённые пары: ячейка занятия перекрывает несколько строк-пар.
            #   pair="3-4", время — от начала верхней пары до конца нижней.
            span = max(1, lesson_cell.rowspan)
            pair_value: int | str | None = pair_number_int
            if span > 1 and r_idx + span - 1 < n_rows:
                bottom_row = rich_rows[r_idx + span - 1]
                bottom_pair = _pair_number_from_cell(bottom_row.value(1))
                if pair_number_int and bottom_pair and bottom_pair > pair_number_int:
                    pair_value = f"{pair_number_int}-{bottom_pair}"

            # Время — из канонического расписания звонков по номеру пары; если
            # пара неизвестна (или вне 1..8), берём то, что напечатано в ячейке.
            canon_start, canon_end = bells_for_pair(pair_value)
            t_start = canon_start or cell_t_start
            t_end = canon_end or cell_t_end
            if not t_start or not t_end:
                continue

            lessons.extend(
                build_lessons_from_cell(
                    lesson_text=lesson_text,
                    room_text=room_text,
                    day=current_day,
                    pair=pair_value,
                    t_start=t_start,
                    t_end=t_end,
                    group_id=f"y{year}-g{num}",
                    year=year,
                    lesson_cell=lesson_cell,
                    room_cell=room_cell,
                )
            )

    return groups, lessons


def _split_blocks_by_blank(lesson_text: str) -> list[dict]:
    """Разделить ячейку на блоки по пустым строкам. Возвращает [{lines:[(idx,text)], start:int}, ...]."""
    blocks: list[dict] = []
    current: list[tuple[int, str]] = []
    current_start: int | None = None
    for i, ln in enumerate((lesson_text or "").splitlines()):
        s = ln.strip()
        if s:
            if not current:
                current_start = i
            current.append((i, s))
        else:
            if current:
                blocks.append({"lines": current, "start": current_start})
                current = []
                current_start = None
    if current:
        blocks.append({"lines": current, "start": current_start})
    return blocks


def _split_blocks_by_teacher_boundary(lesson_text: str) -> list[dict]:
    """Когда нет blank-line разделителя, режем после каждой teacher-строки."""
    blocks: list[dict] = []
    current: list[tuple[int, str]] = []
    current_start: int | None = None
    for i, ln in enumerate((lesson_text or "").splitlines()):
        s = ln.strip()
        if not s:
            continue
        if not current:
            current_start = i
        current.append((i, s))
        if is_teacher_line(s):
            blocks.append({"lines": current, "start": current_start})
            current = []
            current_start = None
    if current:
        if blocks:
            # хвостовые строки без teacher — прицепить к последнему блоку
            blocks[-1]["lines"].extend(current)
        else:
            blocks.append({"lines": current, "start": current_start})
    return blocks


def _split_blocks_by_bold(lesson_cell: RichCell) -> list[dict]:
    """Разбить ячейку на подзанятия, используя жирный шрифт как основной сигнал.

    Название предмета в реальных таблицах всегда выделено жирным. Новый блок
    начинается, когда мы встречаем жирную строку-предмет (не дату-пометку) ПОСЛЕ того,
    как в текущем блоке уже объявлены предмет и преподаватель.
    """
    if not lesson_cell.runs:
        return []
    lines_bold = lesson_cell.lines_with_bold()
    blocks: list[dict] = []
    current: list[tuple[int, str]] = []
    current_start: int | None = None
    have_subject = False
    have_teacher = False
    for i, (ln, is_bold) in enumerate(lines_bold):
        s = (ln or "").strip()
        if not s:
            continue
        # Начало нового блока: жирная не-note строка после того, как в текущем
        # блоке уже есть subject и teacher.
        if (
            is_bold
            and not is_note_line(s)
            and not is_teacher_line(s)
            and have_subject
            and have_teacher
        ):
            if current:
                blocks.append({"lines": current, "start": current_start})
            current = []
            current_start = None
            have_subject = False
            have_teacher = False
        if not current:
            current_start = i
        current.append((i, s))
        # Пометки вроде "по 01.06" обычно тоже жирные, но не предмет; временные метки
        # проверяем отдельно.
        if is_bold and not is_note_line(s) and not is_teacher_line(s):
            have_subject = True
        if is_teacher_line(s):
            have_teacher = True
    if current:
        blocks.append({"lines": current, "start": current_start})
    return blocks


def _parse_block_with_bold(block: dict, bold_lines: set[str]) -> dict:
    """Вариант _parse_block, использующий информацию о жирности строки для
    надёжного выделения названия предмета (всегда жирное).
    """
    teacher_lines: list[str] = []
    subject_lines: list[str] = []
    subgroup_lines: list[str] = []
    note_lines: list[str] = []
    for _, ln in block["lines"]:
        if is_note_line(ln):
            note_lines.append(ln)
        elif is_teacher_line(ln):
            teacher_lines.append(ln)
        elif is_subgroup_only_line(ln):
            subgroup_lines.append(ln)
        elif ln in bold_lines:
            # Жирная не-note/teacher строка — точно название предмета.
            subject_lines.append(strip_leading_subgroup_marker(ln))
        else:
            # Нежирная нераспознанная строка: обычно это продолжение предмета
            # или подгруппа-без-ключевых-слов.
            subject_lines.append(strip_leading_subgroup_marker(ln))

    block_text = "\n".join(ln for _, ln in block["lines"])
    subject = " ".join(s for s in subject_lines if s).strip()

    single_sg: str | None = None
    subgroup_seq: list[str] | None = None
    for sg_ln in subgroup_lines:
        digits = re.findall(r"(\d)\s*ПГ", sg_ln)
        if len(digits) >= 2 and len(teacher_lines) >= 2 and len(digits) == len(teacher_lines):
            subgroup_seq = [f"{d}ПГ" for d in digits]
            break
        if single_sg is None:
            mm = re.match(r"\s*(\d\s*ПГ(?:\s*/\s*\d\s*ПГ)*)\s*", sg_ln)
            if mm:
                single_sg = mm.group(1).replace(" ", "")

    return {
        "subject": subject,
        "subject_lines": subject_lines,
        "subgroup_lines": subgroup_lines,
        "teacher_lines": teacher_lines,
        "single_subgroup": single_sg,
        "subgroup_seq": subgroup_seq,
        "weeks": extract_weeks(block_text),
        "date_from": extract_date_range(block_text)[0],
        "date_to": extract_date_range(block_text)[1],
        "lesson_type": detect_type(block_text),
        "notes": "; ".join(note_lines) or None,
        "raw": block_text,
        "start": block["start"],
    }


def _parse_block(block: dict) -> dict:
    """Разобрать содержимое одного блока на subject/teacher/subgroup/notes/weeks/dates."""
    teacher_lines: list[str] = []
    subject_lines: list[str] = []
    subgroup_lines: list[str] = []
    note_lines: list[str] = []
    for _, ln in block["lines"]:
        if is_note_line(ln):
            note_lines.append(ln)
        elif is_teacher_line(ln):
            teacher_lines.append(ln)
        elif is_subgroup_only_line(ln):
            subgroup_lines.append(ln)
        else:
            subject_lines.append(strip_leading_subgroup_marker(ln))

    block_text = "\n".join(ln for _, ln in block["lines"])
    subject = " ".join(s for s in subject_lines if s).strip()

    # Определяем подгруппы
    single_sg: str | None = None
    subgroup_seq: list[str] | None = None
    for sg_ln in subgroup_lines:
        digits = re.findall(r"(\d)\s*ПГ", sg_ln)
        if len(digits) >= 2 and len(teacher_lines) >= 2 and len(digits) == len(teacher_lines):
            subgroup_seq = [f"{d}ПГ" for d in digits]
            break
        if single_sg is None:
            mm = re.match(r"\s*(\d\s*ПГ(?:\s*/\s*\d\s*ПГ)*)\s*", sg_ln)
            if mm:
                single_sg = mm.group(1).replace(" ", "")

    return {
        "subject": subject,
        "subject_lines": subject_lines,
        "subgroup_lines": subgroup_lines,
        "teacher_lines": teacher_lines,
        "single_subgroup": single_sg,
        "subgroup_seq": subgroup_seq,
        "weeks": extract_weeks(block_text),
        "date_from": extract_date_range(block_text)[0],
        "date_to": extract_date_range(block_text)[1],
        "lesson_type": detect_type(block_text),
        "notes": "; ".join(note_lines) or None,
        "raw": block_text,
        "start": block["start"],
    }


def _normalize_subgroup(sg_text: str) -> str | None:
    """'3ПГ/4ПГ нечет/чет' → '3ПГ/4ПГ'. Возвращает компактное представление."""
    if not sg_text:
        return None
    m = re.match(r"\s*(\d\s*ПГ(?:\s*/\s*\d\s*ПГ)*)\s*", sg_text)
    return m.group(1).replace(" ", "") if m else None


def _assign_rooms(sub_lessons: list[dict], parsed_blocks: list[dict], room_text: str) -> None:
    """Простановка rooms[] в каждом sub-lesson по информации из room_text.

    Правила:
    - 0 аудиторий → rooms = [];
    - 1 аудитория → одна и та же у всех;
    - #аудиторий == #sub-lesson → 1-к-1;
    - иначе пробуем сгруппировать аудитории по пустым строкам.
    """
    room_lines = (room_text or "").splitlines()
    flat = [r.strip() for r in room_lines if r.strip()]
    n_subs = len(sub_lessons)
    if not flat or not sub_lessons:
        for s in sub_lessons:
            s["rooms"] = []
        return
    if len(flat) == 1:
        for s in sub_lessons:
            s["rooms"] = [flat[0]]
        return
    if len(flat) == n_subs:
        for s, r in zip(sub_lessons, flat):
            s["rooms"] = [r]
        return
    # Группируем по пустым строкам
    groups: list[list[str]] = []
    current: list[str] = []
    for ln in room_lines:
        if ln.strip():
            current.append(ln.strip())
        else:
            if current:
                groups.append(current)
                current = []
    if current:
        groups.append(current)
    if len(groups) == n_subs:
        for s, g in zip(sub_lessons, groups):
            s["rooms"] = g
        return
    # 1-to-1 по блокам, аудитория шарится между подзанятиями блока (multi-teacher split)
    if len(flat) == len(parsed_blocks):
        iterator = iter(flat)
        block_assignments: list[list[str]] = []
        for b in parsed_blocks:
            r = next(iterator)
            n_teachers = len(b["teacher_lines"])
            if b.get("subgroup_seq") and n_teachers >= 2 and len(b["subgroup_seq"]) == n_teachers:
                block_assignments.extend([[r]] * n_teachers)
            else:
                block_assignments.append([r])
        if len(block_assignments) == n_subs:
            for s, rs in zip(sub_lessons, block_assignments):
                s["rooms"] = rs
            return
    # fallback: все аудитории всем
    for s in sub_lessons:
        s["rooms"] = list(flat)


def build_lessons_from_cell(
    *,
    lesson_text: str,
    room_text: str,
    day: int,
    pair: int | str | None,
    t_start: str,
    t_end: str,
    group_id: str,
    year: int,
    lesson_cell: RichCell | None = None,
    room_cell: RichCell | None = None,
) -> list[Lesson]:
    """Распарсить одну ячейку расписания в N lesson'ов.

    Алгоритм:
      1. Если доступна информация о жирном шрифте (XLSX), режем ячейку по
         bold-границам (название предмета всегда жирное). Иначе — по пустым
         строкам (и по teacher-границам, если аудиторий больше чем эффективных блоков).
      2. В каждом блоке выделить subject / teachers / subgroup / notes.
      3. Если в блоке N>=2 учителей и подгруппа задана списком вроде '2 ПГ/1 ПГ' длины N —
         расщепить блок на N подзанятий, по одному преподу в каждом.
      4. Сопоставить аудитории: 0/1/N=#sub-lesson/N=#блоков.
      5. Тип занятия — по цвету заливки ячейки (lecture/practice/lab/curator/...).
    """
    if not (lesson_text or "").strip():
        return []

    room_lines = (room_text or "").splitlines()
    n_rooms = sum(1 for r in room_lines if r.strip())

    # Пытаемся использовать bold-информацию (XLSX-путь) — это надёжнее.
    bold_lines: set[str] = set()
    blocks: list[dict] = []
    use_bold_path = False
    if lesson_cell is not None and any(r.bold for r in lesson_cell.runs):
        bold_blocks = _split_blocks_by_bold(lesson_cell)
        if bold_blocks:
            blocks = bold_blocks
            for ln, b in lesson_cell.lines_with_bold():
                if b:
                    s = (ln or "").strip()
                    if s:
                        bold_lines.add(s)
            use_bold_path = True

    if not blocks:
        blocks = _split_blocks_by_blank(lesson_text)
    if not blocks:
        return []

    if use_bold_path:
        parsed_blocks = [_parse_block_with_bold(b, bold_lines) for b in blocks]
    else:
        parsed_blocks = [_parse_block(b) for b in blocks]

    def _effective_count(pbs: list[dict]) -> int:
        total = 0
        for pb in pbs:
            teachers = pb["teacher_lines"]
            if pb.get("subgroup_seq") and len(teachers) >= 2 and len(pb["subgroup_seq"]) == len(teachers):
                total += len(teachers)
            else:
                total += 1
        return total

    # Если эффективных подзанятий меньше, чем аудиторий — пробуем перенарезать по teacher-границам
    if not use_bold_path and _effective_count(parsed_blocks) < n_rooms and n_rooms >= 2:
        alt_blocks = _split_blocks_by_teacher_boundary(lesson_text)
        if alt_blocks:
            alt_parsed = [_parse_block(b) for b in alt_blocks]
            if _effective_count(alt_parsed) == n_rooms:
                blocks = alt_blocks
                parsed_blocks = alt_parsed

    # Если у блока пустой subject, наследуем от предыдущего блока (часто встречается в
    # ячейках вроде "СРиТИ / 1ПГ-2ПГ / Гринько / 3ПГ / Беленькая" — второй учитель ведёт ТОТ ЖЕ предмет)
    last_subject = ""
    for pb in parsed_blocks:
        if pb["subject"]:
            last_subject = pb["subject"]
        else:
            pb["subject"] = last_subject
    # Финальный fallback на первую строку, если предыдущего предмета не было
    for pb, b in zip(parsed_blocks, blocks):
        if not pb["subject"] and b["lines"]:
            pb["subject"] = b["lines"][0][1]

    # Раскладываем блоки в плоский список sub-lessons (учитываем split по нескольким учителям)
    sub_lessons: list[dict] = []
    for pb in parsed_blocks:
        teachers = pb["teacher_lines"]
        subj_lines = pb.get("subject_lines") or []
        sg_lines = pb.get("subgroup_lines") or []
        sg_seq = pb["subgroup_seq"]
        n_t = len(teachers)
        # Кейс A: N>=2 предметов + N учителей + N subgroup-строк (каждый предмет со своей
        # подгруппой). Это новый формат живых таблиц, когда вместо '\n\n' между блоками
        # стоит дата-нота 'с DD.MM' → блок остаётся один, но содержимое чётко делится по индексу.
        if (
            n_t >= 2
            and len(subj_lines) == n_t
            and len(sg_lines) == n_t
        ):
            weeks_seq = [extract_weeks(sg) for sg in sg_lines]
            for s, t, sg_text, wk in zip(subj_lines, teachers, sg_lines, weeks_seq):
                sub_lessons.append({
                    **pb,
                    "subject": s,
                    "teacher": t,
                    "subgroup": _normalize_subgroup(sg_text),
                    "weeks": wk,
                })
        # Кейс B: 1 subject + N учителей + 1 subgroup-строка с N подгруппами (English-кейс):
        # 'Английский язык / 2 ПГ/1 ПГ / Дингилевская / Бурковская' → split по teacher×digit
        elif sg_seq and n_t >= 2 and len(sg_seq) == n_t:
            for t, sg in zip(teachers, sg_seq):
                sub_lessons.append({
                    **pb,
                    "teacher": t,
                    "subgroup": sg,
                })
        else:
            sub_lessons.append({
                **pb,
                "teacher": "; ".join(teachers) or None,
                "subgroup": pb["single_subgroup"],
            })

    _assign_rooms(sub_lessons, parsed_blocks, room_text)

    # Тип занятия по цвету заливки — единый для всех подзанятий из ячейки.
    type_by_color = detect_type_from_fill(lesson_cell.fill) if lesson_cell is not None else None

    out: list[Lesson] = []
    for s in sub_lessons:
        if not s.get("subject"):
            continue
        lid = hash_id(
            group_id, str(day), str(pair), t_start,
            s["subject"], s.get("teacher") or "", s.get("subgroup") or "",
        )
        ltype = type_by_color if type_by_color is not None else s.get("lesson_type")
        out.append(Lesson(
            id=lid,
            group_ids=[group_id],
            day_of_week=day,
            pair_number=pair,
            time_start=t_start,
            time_end=t_end,
            subject=s["subject"],
            lesson_type=ltype,
            teacher=s.get("teacher"),
            rooms=s.get("rooms", []),
            subgroup=s.get("subgroup"),
            weeks=s.get("weeks", "all"),
            date_from=s.get("date_from"),
            date_to=s.get("date_to"),
            notes=s.get("notes"),
            raw=s.get("raw", "").strip(),
        ))
    return out


def build_lesson_from_cell(*, lesson_text: str, room_text: str, day: int, pair: int | None,
                           t_start: str, t_end: str, group_id: str, year: int) -> Lesson | None:
    """DEPRECATED: возвращает только первый lesson из ячейки. Оставлено для обратной совместимости."""
    out = build_lessons_from_cell(
        lesson_text=lesson_text, room_text=room_text,
        day=day, pair=pair, t_start=t_start, t_end=t_end,
        group_id=group_id, year=year,
    )
    return out[0] if out else None


# ---------- master (year 4) ----------

ROOM_PATTERNS = [
    # "ауд. 519 ул.Курчатова,7"
    re.compile(r"ауд\.?\s*([0-9]{2,4}[а-яa-z]?(?:\s*ул\.[А-Яа-яA-Za-z\.]+,?\s*\d+)?)", re.IGNORECASE),
    re.compile(r"room\s+(\d{2,4}[A-Za-z]?(?:\s*\([^)]+\))?)", re.IGNORECASE),
    re.compile(r"\bИКТ\b"),  # locator-only
]


def parse_master_rooms(text: str) -> list[str]:
    rooms: list[str] = []
    # ауд. NNN
    for m in re.finditer(r"ауд\.?\s*([0-9]{1,4}[а-яa-zA-ZА-Я]?)", text):
        rooms.append(m.group(1).strip())
    # room NNN
    for m in re.finditer(r"\broom\s+([0-9]{1,4}[A-Za-z]?)", text, re.IGNORECASE):
        rooms.append(m.group(1).strip())
    # ИКТ — отдельное «здание/корпус»
    if re.search(r"\bИКТ\b", text):
        rooms.append("ИКТ")
    # уникальные, сохранить порядок
    seen = set()
    out: list[str] = []
    for r in rooms:
        if r and r not in seen:
            seen.add(r)
            out.append(r)
    return out


TEACHER_RE = re.compile(
    r"([А-ЯA-Z][а-яa-zА-ЯA-Z\-]+(?:\s+[А-ЯA-Z]\.\s*[А-ЯA-Z]\.|"
    r"\s+[А-ЯA-Z][а-яa-z]+\s+[А-ЯA-Z]\.))"
)


def parse_master_teacher(text: str) -> str | None:
    m = TEACHER_RE.search(text)
    return m.group(1).strip() if m else None


SUBJECT_NOISE = [
    re.compile(r"\d{1,2}\.\d{1,2}(?:\s*[-–]\s*\d{1,2}\.\d{1,2})?"),  # даты
    re.compile(r"ауд\.?\s*[0-9]{1,4}[а-яa-zA-ZА-Я]?"),
    re.compile(r"\broom\s+[0-9]{1,4}[A-Za-z]?", re.IGNORECASE),
    re.compile(r"\bИКТ\b"),
    re.compile(r"ул\.[А-Яа-яA-Za-z\.]+,?\s*\d+"),
    re.compile(r"\(.*?\)"),
    re.compile(r"\b(?:ЛК|ЛБ|LB|LK|Семинар|Seminar|Лекция|ПЗ)\b\s*[-–]?"),
    re.compile(r"\bgroup\s+\d+\b", re.IGNORECASE),
    re.compile(r"\b(?:odd|even)\s+week\b", re.IGNORECASE),
]


def parse_master_subject(text: str, *, rooms: list[str], teacher: str | None) -> str:
    s = text
    if teacher:
        s = s.replace(teacher, "")
    for pat in SUBJECT_NOISE:
        s = pat.sub(" ", s)
    s = re.sub(r"[,;/]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip(" ,.;:-\n")
    return s


def parse_master(rows: list[list[str]], year: int, language: str) -> tuple[list[Group], list[Lesson]]:
    """Парсит лист 4 курса. Колонки = группы/специальности, ячейки могут содержать
    несколько подзанятий, разделённых '/' или переводом строки.
    """
    # найти строку, где col0 — день недели
    header_row_idx = None
    for i, row in enumerate(rows):
        if row and parse_day(row[0]) is not None:
            header_row_idx = i
            break
    if header_row_idx is None:
        return [], []

    # строка над header_row_idx должна содержать названия специальностей в col2+
    program_row_idx = header_row_idx - 1
    # ищем последнюю непустую строку выше с информацией о группе (содержит "гр.")
    for j in range(header_row_idx - 1, -1, -1):
        if any("гр." in (c or "") or "гр " in (c or "") for c in rows[j]):
            program_row_idx = j
            break
    prog_row = rows[program_row_idx]

    group_cols = []
    for col in range(2, max(len(prog_row), max(len(r) for r in rows))):
        cell = prog_row[col] if col < len(prog_row) else ""
        if not cell.strip():
            continue
        m = re.search(r"гр\.?\s*([A-ZА-Я]?\d+)", cell)
        number = m.group(1) if m else str(col)
        # specialty name
        program_name = re.sub(r"\(.*?\)", "", cell).split("гр.")[0].strip()
        program_code = None
        m_code = re.search(r"\((\d-\d{2}-\d{4}-\d{2})\)", cell)
        if m_code:
            program_code = m_code.group(1)
        group_cols.append((col, number, program_name, program_code))

    groups = [
        Group(
            id=f"y{year}-{language}-g{num}",
            year=year,
            number=num,
            program_code=code,
            program_name=name,
            language=language,
        )
        for col, num, name, code in group_cols
    ]

    lessons: list[Lesson] = []
    current_day: int | None = None
    for r_idx in range(header_row_idx, len(rows)):
        row = rows[r_idx]
        if not row or not any(c.strip() for c in row):
            continue
        d = parse_day(row[0]) if len(row) > 0 else None
        if d:
            current_day = d
        if current_day is None:
            continue
        time_cell = row[1] if len(row) > 1 else ""
        t_start, t_end = parse_time_range(time_cell)
        if not t_start or not t_end:
            continue
        for col, num, name, _ in group_cols:
            cell = row[col] if col < len(row) else ""
            if not cell.strip():
                continue
            # разделить по '/' и пустой строке (\n\n)
            sub_cells = [s.strip() for s in re.split(r"(?:^|\n)\s*(?:LB|ЛБ|ЛК|LK|Семинар|Seminar|Лекция|ПЗ)\s*[-–]", "\n" + cell) if s.strip()]
            # сохранить и сам префикс — пересоберём по индексам
            # альтернатива: regex findall с захватом типа+тела
            entries = re.findall(
                r"(LB|ЛБ|ЛК|LK|Семинар|Seminar|Лекция|ПЗ)\s*[-–]\s*([^\n].*?)(?=(?:\n(?:LB|ЛБ|ЛК|LK|Семинар|Seminar|Лекция|ПЗ)\s*[-–])|\Z)",
                cell,
                flags=re.DOTALL,
            )
            if not entries:
                entries = [("", cell)]
            for type_token, body in entries:
                ltype = TYPE_MAP.get(type_token) if type_token else None
                d_from, d_to = extract_date_range(body)
                rooms = parse_master_rooms(body)
                # учитель: последнее имя «Фамилия И.О.» / «Surname N.N.»
                teacher = parse_master_teacher(body)
                subject = parse_master_subject(body, rooms=rooms, teacher=teacher)

                lid = hash_id(f"y{year}-{language}-g{num}", str(current_day), t_start, subject[:40])
                lessons.append(
                    Lesson(
                        id=lid,
                        group_ids=[f"y{year}-{language}-g{num}"],
                        day_of_week=current_day,
                        pair_number=None,
                        time_start=t_start,
                        time_end=t_end,
                        subject=subject or body.strip()[:120],
                        lesson_type=ltype,
                        teacher=teacher,
                        rooms=rooms,
                        subgroup=None,
                        weeks="all",
                        date_from=d_from,
                        date_to=d_to,
                        notes=None,
                        raw=cell.strip(),
                    )
                )
    return groups, lessons


# ---------- main ----------

def build_dataset(
    use_local: bool = False,
    local_dir: str = ".",
    sheets: list[dict] | None = None,
) -> dict:
    """Собрать датасет, прокачав все известные листы.

    Бакалавриат (1–3 курсы) парсится из XLSX (онлайн) или локального .xlsx с
    fallback на .csv — XLSX сохраняет цвет ячеек и жирный шрифт, без которых
    нельзя надёжно определить тип занятия и название предмета.

    Магистратура (4 курс) парсится из CSV — там другая структура без цветовой
    разметки.
    """
    all_groups: list[Group] = []
    all_lessons: list[Lesson] = []
    source_sheets: list[dict] = []
    for sheet in (sheets or SHEETS):
        if sheet["kind"] == "bachelor":
            base_name = f"year{sheet['year']}"
        elif sheet["kind"] == "master_ru":
            base_name = "year4_ru"
        else:
            base_name = "year4_en"

        if sheet["kind"] == "bachelor":
            rich_rows: list[RichRow] | None = None
            if use_local:
                xlsx_path = f"{local_dir}/{base_name}.xlsx"
                if os.path.exists(xlsx_path):
                    rich_rows = read_local_xlsx(xlsx_path)
                else:
                    rich_rows = csv_rows_to_rich_rows(
                        read_local_csv(f"{local_dir}/{base_name}.csv")
                    )
            else:
                rich_rows = fetch_xlsx_rich_rows(sheet["id"], sheet["gid"])
            g, l = parse_bachelor(rich_rows, sheet["year"])
        else:
            csv_path = f"{local_dir}/{base_name}.csv"
            if use_local:
                rows_csv = read_local_csv(csv_path)
            else:
                rows_csv = fetch_csv(sheet["id"], sheet["gid"])
            language = "ru" if sheet["kind"] == "master_ru" else "en"
            g, l = parse_master(rows_csv, sheet["year"], language)
        all_groups.extend(g)
        all_lessons.extend(l)
        source_sheets.append({
            "year": sheet["year"],
            "kind": sheet["kind"],
            "sheet_id": sheet["id"],
            "gid": sheet["gid"],
        })

    return {
        "academic_year": "2025-2026",
        "faculty": "ФРФиКТ",
        "semester": 2,
        "form": "очная",
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": {"type": "google_sheets", "sheets": source_sheets},
        "groups": [asdict(g) for g in all_groups],
        "lessons": [asdict(l) for l in all_lessons],
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="schedule.json")
    ap.add_argument("--local", action="store_true", help="читать локальные year*.csv")
    ap.add_argument("--local-dir", default=".")
    ap.add_argument(
        "--discover",
        action="store_true",
        help="вытащить список таблиц с rct.bsu.by/education вместо захардкоженного SHEETS",
    )
    args = ap.parse_args()

    sheets: list[dict] | None = None
    if args.discover:
        from schedule_parser.discover_sheets import discover
        discovered = discover()
        sheets = [
            {"year": s["year"], "id": s["sheet_id"], "gid": s["gid"], "kind": s["kind"], "semester": 2}
            for s in discovered
        ]
        print(f"discovered {len(sheets)} sheets from rct.bsu.by", file=sys.stderr)

    data = build_dataset(use_local=args.local, local_dir=args.local_dir, sheets=sheets)
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
    print(f"wrote {args.out}: {len(data['groups'])} groups, {len(data['lessons'])} lessons", file=sys.stderr)


if __name__ == "__main__":
    main()
