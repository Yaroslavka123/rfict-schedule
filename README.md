# rfict-schedule

JSON-API расписания факультета **РФиКТ БГУ**. Парсит Google Sheets, на которые ссылается
страница [rct.bsu.by/education](https://rct.bsu.by/education), и публикует один валидный
`schedule.json` через GitHub Pages. Источник истины — публичные таблицы факультета.

- **JSON:** `https://yaroslavka123.github.io/rfict-schedule/schedule.json`
- **Schema:** `https://yaroslavka123.github.io/rfict-schedule/schedule.schema.json`
- **Обновление:** каждые 5 минут (cron) + мгновенно по `onEdit` (опционально, см. ниже).

## Архитектура

```
┌─────────────────────────────┐
│  rct.bsu.by/education       │  ← публичный сайт факультета
└─────────────┬───────────────┘
              │ discover_sheets.py: regexp по ссылкам
              ▼
┌─────────────────────────────┐
│  5 Google Sheets (CSV)      │
│  1/2/3 курс, магистратура RU/EN │
└─────────────┬───────────────┘
              │ parse_schedule.py: CSV → нормализованный JSON
              ▼
┌─────────────────────────────┐      ┌──────────────────────────┐
│  public/schedule.json       │ ◄──── │ GitHub Actions cron 5 м │
└─────────────┬───────────────┘      └──────────────────────────┘
              │ deploy-pages
              ▼
┌─────────────────────────────┐
│  GitHub Pages (статический CDN) │
└─────────────┬───────────────┘
              │ http.Get
              ▼
        Go-бэкенд → мобильное приложение
```

## Структура JSON

См. `schema/schedule.schema.json`. Кратко:

```json
{
  "academic_year": "2025-2026",
  "faculty": "ФРФиКТ",
  "semester": 2,
  "form": "очная",
  "generated_at": "2026-05-11T13:00:00Z",
  "source": { "type": "google_sheets", "sheets": [...] },
  "groups": [
    {"id": "y1-g1", "year": 1, "number": 1, "program_code": "РФ", "language": "ru"}
  ],
  "lessons": [
    {
      "id": "33a008816b61",
      "group_ids": ["y1-g1"],
      "day_of_week": 1,
      "pair_number": 1,            // или "3-4" для объединённой на несколько пар ячейки
      "time_start": "09:00",
      "time_end": "10:25",
      "subject": "Электричество и магнетизм",
      "lesson_type": "lecture",
      "teacher": "ст.пр. РаткевичС.В.",
      "rooms": ["117"],
      "subgroup": null,
      "weeks": "all",
      "date_from": null,
      "date_to": "2026-05-11",
      "notes": "по 11.05",
      "raw": "по 11.05\nЭлектричество..."
    }
  ]
}
```

## Локальный запуск

```bash
git clone https://github.com/Yaroslavka123/rfict-schedule.git
cd rfict-schedule
pip install -r requirements.txt

# Прогнать тесты на фикстурах
pytest -v

# Спарсить расписание с авто-дискавери (онлайн)
python run.py --discover --out public/schedule.json

# То же на сохранённых CSV (оффлайн)
python run.py --local --local-dir tests/fixtures --out public/schedule.json
```

## Использование из Go

```go
package main

import (
	"encoding/json"
	"net/http"
)

type Lesson struct {
	ID        string   `json:"id"`
	GroupIDs  []string `json:"group_ids"`
	DayOfWeek int      `json:"day_of_week"`
	TimeStart string   `json:"time_start"`
	TimeEnd   string   `json:"time_end"`
	Subject   string   `json:"subject"`
	// ... остальные поля
}

type Schedule struct {
	AcademicYear string   `json:"academic_year"`
	Groups       []Group  `json:"groups"`
	Lessons      []Lesson `json:"lessons"`
}

func Fetch() (*Schedule, error) {
	resp, err := http.Get("https://yaroslavka123.github.io/rfict-schedule/schedule.json")
	if err != nil { return nil, err }
	defer resp.Body.Close()
	var s Schedule
	return &s, json.NewDecoder(resp.Body).Decode(&s)
}
```

## Гибрид (мгновенное обновление по onEdit)

Cron в GitHub Actions = **до 5 минут** задержки. Чтобы было мгновенно, в каждую из
5 Google Sheets ставится bound-скрипт `apps_script/onEdit_trigger.gs` — он по событию
`onEdit` дёргает GitHub `repository_dispatch`, который тут же запускает workflow.

**Ставится один раз ВЛАДЕЛЬЦЕМ таблицы.** Если доступа нет — пропускаем, cron всё равно
догонит за 5 минут.

Подробные шаги — комментарий в файле `apps_script/onEdit_trigger.gs`.

## Что внутри парсера

- **Курсы 1–3 (бакалавриат)** — фиксированная сетка `день | пара | время | (предмет, ауд.) × группы`.
  Парсится из **XLSX-экспорта** (не CSV), чтобы сохранить форматирование:
  - **Цвет ячейки → `lesson_type`**: зелёный → `lecture`, оранжевый → `lab`,
    синий → `practice`, жёлтый → `curator_hour`, фиолетовый → `additional` (ДО).
  - **Жирный шрифт → `subject`** (название предмета всегда выделено жирным).
  - **Merged-ячейки** (занятие на 2 пары подряд) → `pair_number: "3-4"`,
    `time_start`/`time_end` охватывают обе пары.
  Остальные эвристики: подгруппа (`1ПГ`/`2ПГ`), чёт/нечёт, даты «по 11.05»,
  имена преподавателей.
- **4 курс (магистратура)** — колонки = специальности; в одной ячейке могут лежать
  несколько подзанятий, разделённых `/` и `\n`. Парсер режет их через regexp по префиксам
  `ЛК`/`ЛБ`/`Семинар`/`LB`/`LK`.
- **Авто-дискавери** — `discover_sheets.py` парсит `rct.bsu.by/education`, по тексту ссылок
  (`«1 курс расписание»`, `«магистратура»`, `«Cybersecurity»`) распознаёт курс/тип.

## Тесты

42 теста на фикстурах в `tests/fixtures/` (HTML сайта + 5 CSV). Запуск: `pytest`.

Покрывают:
- helpers (`parse_day`, `parse_time_range`, `extract_subgroup`, …)
- master-парсер (room/teacher/subject extraction)
- интеграцию 1/2/3 курса + магистратуры
- авто-дискавери (моком HTTP по фикстуре HTML)
- полный билд + валидация JSON Schema

## Лицензия

MIT.
