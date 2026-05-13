"""Извлечение стартовых словарей предметов/преподов/аудиторий из public/schedule.json.

Запускать:
    python apps_script/labs_form/dictionaries/extract.py

Результат:
    apps_script/labs_form/dictionaries/subjects.json
    apps_script/labs_form/dictionaries/teachers.json
    apps_script/labs_form/dictionaries/rooms.json
"""

from __future__ import annotations

import json
import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
SCHEDULE_PATH = REPO_ROOT / "public" / "schedule.json"
OUT_DIR = Path(__file__).resolve().parent

# Строки, которые точно НЕ являются предметом — они попали туда из мусора в ячейках.
NON_SUBJECT_PATTERNS = [
    re.compile(r"^\d{1,2}[.:]\d{2}"),           # время или дата
    re.compile(r"^\d{1,2}[.,]"),                # «09.02,» — дата
    re.compile(r"^с\s+\d{1,2}"),                # «с 02.03» — диапазон дат
    re.compile(r"^по\s+\d{1,2}"),               # «по 01.06»
    re.compile(r"^Замена"),                     # «Замена с 12.02 по 26.02 …»
    re.compile(r"^c\s+\d{1,2}"),                # латинская «c» вместо «с»
]


def is_subject(s: str) -> bool:
    s = s.strip()
    if not s:
        return False
    if len(s) < 2:
        return False
    for p in NON_SUBJECT_PATTERNS:
        if p.match(s):
            return False
    return True


def normalize_teacher(t: str) -> str:
    return t.strip().replace("  ", " ")


def main() -> None:
    data = json.loads(SCHEDULE_PATH.read_text(encoding="utf-8"))
    lessons = data.get("lessons", [])

    subjects: set[str] = set()
    teachers: set[str] = set()
    rooms: set[str] = set()

    for lesson in lessons:
        subj = lesson.get("subject", "")
        if is_subject(subj):
            subjects.add(subj.strip())

        teacher = lesson.get("teacher")
        if teacher:
            for t in teacher.split(";"):
                norm = normalize_teacher(t)
                if norm:
                    teachers.add(norm)

        for room in lesson.get("rooms") or []:
            for r in room.split():
                r = r.strip()
                if r:
                    rooms.add(r)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "subjects.json").write_text(
        json.dumps(sorted(subjects), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (OUT_DIR / "teachers.json").write_text(
        json.dumps(sorted(teachers), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (OUT_DIR / "rooms.json").write_text(
        json.dumps(sorted(rooms), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print(f"subjects: {len(subjects)}")
    print(f"teachers: {len(teachers)}")
    print(f"rooms:    {len(rooms)}")


if __name__ == "__main__":
    main()
