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
            les = build_lesson_from_cell(
                lesson_text=lesson_text,
                room_text=room_text,
                day=current_day,
                pair=pair_number,
                t_start=t_start,
                t_end=t_end,
                group_id=f"y{year}-g{num}",
                year=year,
            )
            if les:
                lessons.append(les)

    return groups, lessons


def build_lesson_from_cell(*, lesson_text: str, room_text: str, day: int, pair: int | None,
                           t_start: str, t_end: str, group_id: str, year: int) -> Lesson | None:
    lines = clean_lines(lesson_text)
    if not lines:
        return None

    notes: list[str] = []
    subject_lines: list[str] = []
    teacher_lines: list[str] = []
    subgroup = extract_subgroup(lesson_text)
    weeks = extract_weeks(lesson_text)
    d_from, d_to = extract_date_range(lesson_text)
    lesson_type = detect_type(lesson_text)
    # эвристика: строки начинающиеся "по", "с ... по", "отмены", "доп.", "отработка" — заметки
    for ln in lines:
        low = ln.lower()
        if re.match(r"^(по\s+\d|с\s+\d|отмены|отработк|доп\.|до\s+\d|с\s+\d)", low):
            notes.append(ln)
        elif re.match(r"^(доц\.|ст\.пр\.|пр\.ст\.|асс\.|проф\.|преп\.)", low):
            teacher_lines.append(ln)
        elif "ПГ" in ln and len(ln) < 20:
            # типа "1ПГ/2ПГ нечет"
            continue
        else:
            subject_lines.append(ln)

    subject = " ".join(subject_lines).strip()
    if not subject:
        subject = lines[0]
    teacher = "; ".join(teacher_lines).strip() or None

    rooms = [r.strip() for r in re.split(r"[\n,;]", room_text or "") if r.strip()]
    raw = lesson_text + ("\n[room] " + room_text if room_text else "")

    lid = hash_id(group_id, str(day), str(pair), t_start, subject)
    return Lesson(
        id=lid,
        group_ids=[group_id],
        day_of_week=day,
        pair_number=pair,
        time_start=t_start,
        time_end=t_end,
        subject=subject,
        lesson_type=lesson_type,
        teacher=teacher,
        rooms=rooms,
        subgroup=subgroup,
        weeks=weeks,
        date_from=d_from,
        date_to=d_to,
        notes="; ".join(notes) or None,
        raw=raw.strip(),
    )


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
