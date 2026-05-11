"""Авто-дискавери Google Sheets c расписанием с сайта факультета.

Парсит https://rct.bsu.by/education, находит ссылки на docs.google.com/spreadsheets
и по тексту ссылки распознаёт курс/тип.

Использование:
    python discover_sheets.py                 # печатает JSON со списком таблиц
    python discover_sheets.py --update-parser # обновляет SHEETS в parse_schedule.py
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.request

EDU_URL = "https://rct.bsu.by/education"

HREF_RE = re.compile(
    r'<a[^>]*href="(https://docs\.google\.com/spreadsheets/[^"]+)"[^>]*>(.*?)</a>',
    re.DOTALL,
)
ID_RE = re.compile(r"/spreadsheets/d/([A-Za-z0-9_-]+)")
GID_RE = re.compile(r"[?&#]gid=(\d+)")


def strip_tags(s: str) -> str:
    return re.sub(r"<[^>]+>", "", s).strip()


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "schedule-discover/1.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read().decode("utf-8", errors="replace")


def classify(text: str) -> dict | None:
    """По тексту ссылки определить курс/семестр/тип."""
    t = text.lower()
    # магистратура (английская версия)
    if "cybersecurity" in t or "master degree" in t:
        return {"year": 4, "kind": "master_en", "label": "Cybersecurity (master, EN)"}
    # магистратура (русская)
    if "магистрат" in t:
        return {"year": 4, "kind": "master_ru", "label": "Магистратура 1 курс"}
    # бакалавриат: «1 курс расписание», «2 курс …»
    m = re.search(r"(\d)\s*курс", t)
    if m:
        year = int(m.group(1))
        if 1 <= year <= 4:
            return {"year": year, "kind": "bachelor", "label": f"Бакалавриат {year} курс"}
    return None


def discover(url: str = EDU_URL) -> list[dict]:
    html = fetch(url)
    found: dict[tuple[int, str], dict] = {}
    for m in HREF_RE.finditer(html):
        href, text = m.group(1), strip_tags(m.group(2))
        cls = classify(text)
        if not cls:
            continue
        sid_m = ID_RE.search(href)
        gid_m = GID_RE.search(href)
        if not sid_m:
            continue
        sheet_id = sid_m.group(1)
        gid = gid_m.group(1) if gid_m else "0"
        key = (cls["year"], cls["kind"])
        # если для года/типа уже была запись — оставляем первую
        if key in found:
            continue
        found[key] = {
            "year": cls["year"],
            "kind": cls["kind"],
            "label": cls["label"],
            "sheet_id": sheet_id,
            "gid": gid,
            "link_text": text,
            "edit_url": href,
            "csv_url": (
                f"https://docs.google.com/spreadsheets/d/{sheet_id}"
                f"/export?format=csv&gid={gid}"
            ),
        }
    # стабильный порядок: 1, 2, 3, 4 ru, 4 en
    order_kind = {"bachelor": 0, "master_ru": 1, "master_en": 2}
    return sorted(found.values(), key=lambda x: (x["year"], order_kind.get(x["kind"], 9)))


def update_parser(parser_path: str, sheets: list[dict]) -> None:
    """Перезаписать константу SHEETS в parse_schedule.py."""
    with open(parser_path, encoding="utf-8") as fh:
        src = fh.read()
    # сгенерировать блок
    entries = []
    for s in sheets:
        # semester: эвристика — бакалавр 1-3 курс = 2 семестр (весна); 4 курс = 2 семестр магистратуры
        semester = 2 if s["year"] == 1 else (4 if s["year"] == 2 else (6 if s["year"] == 3 else 2))
        entries.append(
            f'    {{"year": {s["year"]}, "semester": {semester}, '
            f'"id": "{s["sheet_id"]}", "gid": "{s["gid"]}", '
            f'"kind": "{s["kind"]}"}},'
        )
    new_block = "SHEETS = [\n" + "\n".join(entries) + "\n]"
    new_src = re.sub(r"SHEETS\s*=\s*\[.*?\n\]", new_block, src, count=1, flags=re.DOTALL)
    if new_src == src:
        print("warning: SHEETS block not found in parser", file=sys.stderr)
        return
    with open(parser_path, "w", encoding="utf-8") as fh:
        fh.write(new_src)
    print(f"updated {parser_path}", file=sys.stderr)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=EDU_URL)
    ap.add_argument("--update-parser", metavar="PATH", help="обновить SHEETS в parse_schedule.py")
    ap.add_argument("--out", help="записать результат в файл вместо stdout")
    args = ap.parse_args()

    sheets = discover(args.url)
    payload = json.dumps(sheets, ensure_ascii=False, indent=2)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as fh:
            fh.write(payload)
    else:
        print(payload)

    if args.update_parser:
        update_parser(args.update_parser, sheets)


if __name__ == "__main__":
    main()
