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
import re
import sys
import urllib.request
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Iterable

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
    pair_number: int | None
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


def parse_bachelor(rows: list[list[str]], year: int) -> tuple[list[Group], list[Lesson]]:
    """Парсит листы 1-3 курса (одинаковая структура)."""
    # ряд с программой — row 3, ряд с группами — row 4
    prog_row = rows[3]
    grp_row = rows[4]

    # колонки с группами: где в grp_row начинается «Группа …»
    group_cols: list[tuple[int, str, str | None, str | None]] = []
    last_prog = None
    for col, cell in enumerate(grp_row):
        prog_cell = prog_row[col] if col < len(prog_row) else ""
        if prog_cell.strip():
            last_prog = prog_cell.strip()
        m = re.match(r"\s*Группа\s+(\S+)\s*\n?(.*)", cell or "", re.DOTALL)
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
    for r_idx in range(5, len(rows)):
        row = rows[r_idx]
        if not any(c.strip() for c in row):
            continue
        day_cell = row[0] if len(row) > 0 else ""
        pair_cell = row[1] if len(row) > 1 else ""
        time_cell = row[2] if len(row) > 2 else ""
        d = parse_day(day_cell)
        if d:
            current_day = d
        if current_day is None:
            continue
        pair_number = int(pair_cell) if (pair_cell or "").strip().isdigit() else None
        t_start, t_end = parse_time_range(time_cell)
        if not t_start or not t_end:
            continue

        for col, num, prog, _ in group_cols:
            lesson_text = row[col] if col < len(row) else ""
            room_text = row[col + 1] if col + 1 < len(row) else ""
            if not lesson_text.strip():
                continue
            lessons.extend(
                build_lessons_from_cell(
                    lesson_text=lesson_text,
                    room_text=room_text,
                    day=current_day,
                    pair=pair_number,
                    t_start=t_start,
                    t_end=t_end,
                    group_id=f"y{year}-g{num}",
                    year=year,
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


def build_lessons_from_cell(*, lesson_text: str, room_text: str, day: int, pair: int | None,
                            t_start: str, t_end: str, group_id: str, year: int) -> list[Lesson]:
    """Распарсить одну ячейку расписания в N lesson'ов.

    Алгоритм:
      1. Разбить текст на блоки по пустым строкам (если их нет — пробуем по teacher-границам,
         когда количество аудиторий подсказывает что блоков должно быть больше).
      2. В каждом блоке выделить subject / teachers / subgroup / notes.
      3. Если в блоке N>=2 учителей и подгруппа задана списком вроде '2 ПГ/1 ПГ' длины N —
         расщепить блок на N подзанятий, по одному преподу в каждом.
      4. Сопоставить аудитории: 0/1/N=#sub-lesson/N=#блоков.
    """
    if not (lesson_text or "").strip():
        return []

    room_lines = (room_text or "").splitlines()
    n_rooms = sum(1 for r in room_lines if r.strip())

    blocks = _split_blocks_by_blank(lesson_text)
    if not blocks:
        return []
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
    if _effective_count(parsed_blocks) < n_rooms and n_rooms >= 2:
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

    out: list[Lesson] = []
    for s in sub_lessons:
        if not s.get("subject"):
            continue
        lid = hash_id(
            group_id, str(day), str(pair), t_start,
            s["subject"], s.get("teacher") or "", s.get("subgroup") or "",
        )
        out.append(Lesson(
            id=lid,
            group_ids=[group_id],
            day_of_week=day,
            pair_number=pair,
            time_start=t_start,
            time_end=t_end,
            subject=s["subject"],
            lesson_type=s.get("lesson_type"),
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
    all_groups: list[Group] = []
    all_lessons: list[Lesson] = []
    source_sheets: list[dict] = []
    for sheet in (sheets or SHEETS):
        if sheet["kind"] == "bachelor":
            local_name = f"year{sheet['year']}.csv"
        elif sheet["kind"] == "master_ru":
            local_name = "year4_ru.csv"
        else:
            local_name = "year4_en.csv"
        if use_local:
            rows = read_local_csv(f"{local_dir}/{local_name}")
        else:
            rows = fetch_csv(sheet["id"], sheet["gid"])
        if sheet["kind"] == "bachelor":
            g, l = parse_bachelor(rows, sheet["year"])
        else:
            language = "ru" if sheet["kind"] == "master_ru" else "en"
            g, l = parse_master(rows, sheet["year"], language)
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
