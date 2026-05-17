# Backend handoff

Документ для backend-команды: что нужно реализовать, чтобы frontend и Apps Script parser работали без костылей.

## Главный принцип архитектуры

**Backend — основное хранилище.** GitHub и `public/schedule/*.json` используются только как тестовый fallback на время разработки. В production frontend всегда читает данные из backend, поэтому требования ниже обязательны.

Frontend-heavy, backend-light: backend хранит и отдаёт данные, frontend сам считает аналитику и фильтрует.

### Frontend отвечает за

- фильтры по курсу, неделе, группе, подгруппе, типу занятия и поиску;
- группировку занятий по дням, группам, кабинетам, преподавателям;
- расчёт фактических часов из `lessons` (план-факт);
- отображение конфликтов и пустых состояний;
- кэширование плана в `localStorage` пока backend недоступен (только dev/test);
- test-fallback на GitHub raw и `public/schedule`.

### Backend отвечает за

- приём расписания от Apps Script parser и его хранение;
- выдачу расписания **целиком по курсу** (все недели, чтобы frontend не делал N запросов);
- хранение и выдачу плана по предметам (`planned_pairs` на курс/предмет);
- realtime-канал (SSE/WebSocket) или version-endpoint для polling, чтобы UI обновлялся без перезагрузки;
- сохранение и возврат `google_sheet_id`, чтобы frontend мог открыть исходную Google таблицу;
- CORS для frontend origins.

Backend не должен реализовывать сложные UI-фильтры. Frontend получает полное расписание курса и фильтрует его сам.

## Production domain

```text
https://rfict.up.railway.app
```

Apps Script использует этот домен по умолчанию. При необходимости домен можно переопределить через Script Properties:

```text
BACKEND_API_URL=https://rfict.up.railway.app
```

## Минимальный набор endpoints

### 1. Получить расписание курса (все недели сразу)

```http
GET /api/v1/schedule?course=1
Accept: application/json
```

Frontend запрашивает расписание **целиком по курсу** — все недели за один запрос. Это упрощает фильтры (фильтр по неделе делается на frontend) и нужно для вкладок «Кабинеты» и «Аналитика», где данные считаются по всему семестру.

Рекомендуемый ответ:

```json
{
  "course": 3,
  "generated_at": "2026-05-17T19:00:00Z",
  "groups": [
    { "id": "g-1", "name": "ИКБО-01-23", "count": 25 }
  ],
  "weeks": [
    {
      "name": "14-я неделя",
      "generated_at": "2026-05-17T19:00:00Z",
      "course": 3,
      "semester": 6,
      "week_number": 14,
      "date_range": "12.05.2026 — 18.05.2026",
      "groups": [
        { "id": "g-1", "name": "ИКБО-01-23", "count": 25 }
      ],
      "lessons": [
        {
          "day": "Пн",
          "day_number": 1,
          "date": "2026-05-12",
          "pair": 1,
          "duration": 2,
          "time": "09:00-10:30",
          "group": "g-1",
          "type": "lecture",
          "subject": "Математика",
          "teacher": "Иванов И.И.",
          "room": "А-101",
          "subgroup": null,
          "frequency": null,
          "period_start": null,
          "period_end": null,
          "comment": null,
          "cancelled": false,
          "week_number": 14,
          "google_sheet_id": "1abc...xyz"
        }
      ]
    }
  ]
}
```

Frontend также принимает:

```json
{ "weeks": [ ... ] }
```

или просто массив недель:

```json
[ { "week_number": 1, ... }, { "week_number": 2, ... } ]
```

Per-week endpoint `GET /api/v1/schedule?course=N&week=M` тоже поддерживается, но не используется UI — оставить как удобство для интеграций.

### 2. Принять расписание от Apps Script parser

```http
POST /api/v1/schedule
Content-Type: application/json
```

Parser отправляет JSON того же формата, что frontend ожидает в `GET /api/v1/schedule`.

Минимальное поведение backend:

1. принять payload;
2. провалидировать `course`, `week_number`, `lessons`;
3. заменить расписание для пары `course + week_number` целиком или выполнить idempotent upsert;
4. сохранить `generated_at`, `semester`, `date_range`, `groups`, `lessons`;
5. сохранить `google_sheet_id` у каждого занятия;
6. вернуть успешный JSON-ответ.

Рекомендуемый успешный ответ:

```json
{
  "ok": true,
  "course": 3,
  "week_number": 14,
  "lessons_count": 120,
  "updated_at": "2026-05-17T19:00:00Z"
}
```

Ошибки:

```json
{
  "ok": false,
  "error": "invalid_payload",
  "message": "course and week_number are required"
}
```

### 3. Справочник предметов

```http
GET /api/v1/subjects
Accept: application/json
```

Минимальный ответ:

```json
[
  {
    "id": 1,
    "name": "Математика"
  }
]
```

### 4. Справочник преподавателей

```http
GET /api/v1/teachers
Accept: application/json
```

Минимальный ответ:

```json
[
  {
    "id": 1,
    "name": "Иванов И.И."
  }
]
```

### 5. Справочник кабинетов

```http
GET /api/v1/rooms
Accept: application/json
```

Минимальный ответ:

```json
[
  {
    "id": 1,
    "name": "А-101"
  }
]
```

## План занятий (`planned_pairs`)

Это **основное требование от методистов**: для каждого предмета на курсе хранится одно число — сколько пар по плану нужно провести (за семестр или за весь курс, на усмотрение методиста). План — общий для всех групп/подгрупп курса. Frontend сам считает факт: сколько пар стоит в расписании и сколько фактически прошло на текущую дату.

Ключ записи плана — `(course, subject)`. Не нужны отдельные поля `group`, `teacher`, `type` — учёт идёт строго по предмету курса.

### 6. Получить план курса

```http
GET /api/v1/plan?course=3
Accept: application/json
```

Ответ (плоский массив или обёртка):

```json
[
  {
    "course": 3,
    "subject": "Математический анализ",
    "planned_pairs": 24
  },
  {
    "course": 3,
    "subject": "Алгебра",
    "planned_pairs": 18
  }
]
```

Также допустима обёртка (frontend разворачивает любой из вариантов):

```json
{ "plan":    [ ... ] }
{ "data":    [ ... ] }
{ "entries": [ ... ] }
```

Обязательные поля элемента плана:

```ts
{
  course: number
  subject: string
  planned_pairs: number  // целое неотрицательное
}
```

### 7. Обновить запись плана (upsert по `course + subject`)

Frontend отправляет PUT с одной записью за раз — при редактировании поля в таблице аналитики.

```http
PUT /api/v1/plan
Content-Type: application/json
```

Payload:

```json
{
  "course": 3,
  "subject": "Математический анализ",
  "planned_pairs": 24
}
```

Backend должен:

1. найти запись с тем же `(course, subject)` (нормализуй `subject`: trim, lower);
2. если нашёл — обновить `planned_pairs`;
3. если не нашёл — создать запись;
4. вернуть `200 OK` (тело произвольное, frontend смотрит только на статус).

Если хочется поддержать batch upsert — массив:

```http
PUT /api/v1/plan/batch
```

```json
[
  { "course": 3, "subject": "Математический анализ", "planned_pairs": 24 },
  { "course": 3, "subject": "Алгебра",               "planned_pairs": 18 }
]
```

Не обязательно для MVP — пока хватает per-entry PUT.

### Поведение frontend при недоступном backend

Frontend кэширует план в `localStorage` под ключом `rfict-plan-course-{N}` — это **только для разработки и тестов**. В production backend обязан возвращать план; иначе у разных методистов будут разные числа.

## Обновления с минимальной задержкой

Это обязательное требование для удобной работы: когда Apps Script parser отправил новое расписание в backend, frontend должен узнать об этом почти сразу.

Статический JSON fallback через GitHub не подходит для мгновенных обновлений: `raw.githubusercontent.com` может кэшировать файлы несколько минут. Для минимальной задержки frontend должен работать через backend API.

Рекомендуемый поток:

```text
Google Sheets → Apps Script parser → POST /api/v1/schedule → backend DB/cache
                                                ↓
                         backend меняет version/updated_at и уведомляет frontend
                                                ↓
                         frontend refetch GET /api/v1/schedule?course=N&week=M
```

### Вариант A: SSE/WebSocket, лучший вариант

Backend после успешного `POST /api/v1/schedule` отправляет событие всем клиентам, которые смотрят этот курс/неделю.

SSE:

```http
GET /api/v1/schedule/events?course=3&week=14
Accept: text/event-stream
```

Событие:

```json
{
  "type": "schedule_updated",
  "course": 3,
  "week": 14,
  "updated_at": "2026-05-17T19:00:00Z",
  "version": "2026-05-17T19:00:00Z"
}
```

WebSocket альтернатива:

```http
WS /api/v1/schedule/live?course=3&week=14
```

### Вариант B: короткий polling, проще для первого релиза

Frontend раз в 5–10 секунд спрашивает lightweight endpoint, не скачивая всё расписание:

```http
GET /api/v1/schedule/updates?course=3&week=14
```

Ответ:

```json
{
  "course": 3,
  "week": 14,
  "updated_at": "2026-05-17T19:00:00Z",
  "version": "2026-05-17T19:00:00Z"
}
```

Если `version` изменился, frontend делает:

```http
GET /api/v1/schedule?course=3&week=14
```

и перерисовывает экран.

## Optional endpoints

Эти endpoints не обязательны для первого рабочего релиза, потому что frontend может считать сам.

### 8. План-факт на backend

```http
GET /api/v1/analytics/plan-fact?course=3&semester=6&week=14
```

Можно реализовать позже, если нужно ускорить большие отчёты или выгрузки.

Ответ:

```json
{
  "course": 3,
  "semester": 6,
  "week": 14,
  "items": [
    {
      "group": "ИКБО-01-23",
      "subject": "Математика",
      "teacher": "Иванов И.И.",
      "type": "ЛК",
      "planned_hours": 36,
      "actual_hours": 10,
      "delta_hours": -26,
      "progress_percent": 27.78
    }
  ]
}
```

## Parser payload contract

Apps Script parser формирует объект расписания и отправляет его в backend.

Важные top-level поля:

```ts
{
  name: string
  generated_at: string
  course: number
  semester: number
  week_number: number
  date_range: string
  groups: { name: string; count: number }[]
  lessons: Lesson[]
}
```

Важные поля `Lesson`:

```ts
{
  day: string
  day_number: number
  date: string | null
  pair: number
  duration: number
  time: string
  group: string
  type: string
  subject: string
  teacher: string | null
  room: string | null
  subgroup: string | null
  frequency: string | null
  period_start: string | null
  period_end: string | null
  comment: string | null
  cancelled: boolean
  google_sheet_id: string | null
}
```

Критичные поля для frontend:

- `course`
- `semester`
- `week_number`
- `date_range`
- `groups`
- `lessons`
- `lessons[].date`
- `lessons[].google_sheet_id`

## Рекомендации по хранению

Минимально достаточно следующих сущностей:

```text
schedule_week
- id
- course
- semester
- week_number
- name
- date_range
- generated_at
- updated_at

schedule_group
- id
- schedule_week_id
- name
- count

schedule_lesson
- id
- schedule_week_id
- day
- day_number
- date
- pair
- duration
- time
- group_name
- type
- subject
- teacher
- room
- subgroup
- frequency
- period_start
- period_end
- comment
- cancelled
- google_sheet_id

plan_item
- id
- course
- semester
- group_name
- subject
- teacher
- type
- planned_hours
- updated_at
```

Индексы:

```text
schedule_week(course, week_number)
schedule_lesson(schedule_week_id)
schedule_lesson(group_name)
schedule_lesson(subject)
schedule_lesson(teacher)
schedule_lesson(room)
plan_item(course, semester)
plan_item(course, semester, group_name)
```

## CORS

Frontend должен иметь доступ к backend из браузера.

Для dev/prod нужно разрешить origins:

```text
http://localhost:5173
http://localhost:4173
https://yaroslavka123.github.io
```

Если production-домен frontend будет другой, добавить и его.

Методы:

```text
GET, POST, PUT, OPTIONS
```

Headers:

```text
Content-Type, Accept
```

## Проверка backend готовности

### Read-only endpoints

```bash
python3 - <<'PY'
from urllib.request import Request, urlopen
base = 'https://rfict.up.railway.app'
for path in ['/api/v1/subjects', '/api/v1/teachers', '/api/v1/rooms']:
    req = Request(base + path, headers={'Accept': 'application/json'})
    with urlopen(req, timeout=20) as resp:
        print(path, resp.status)
PY
```

### Schedule GET

```bash
python3 - <<'PY'
import json
from urllib.request import Request, urlopen
url = 'https://rfict.up.railway.app/api/v1/schedule?course=1&week=1'
req = Request(url, headers={'Accept': 'application/json'})
with urlopen(req, timeout=20) as resp:
    data = json.load(resp)
print(data.keys())
print(len(data.get('lessons', [])))
PY
```

### Parser POST

Проверять только на тестовых данных или тестовом backend:

```bash
curl -X POST 'https://rfict.up.railway.app/api/v1/schedule' \
  -H 'Content-Type: application/json' \
  --data @schedule-example.json
```

## Acceptance checklist для backend

- `GET /api/v1/subjects` возвращает JSON.
- `GET /api/v1/teachers` возвращает JSON.
- `GET /api/v1/rooms` возвращает JSON.
- `POST /api/v1/schedule` принимает parser payload.
- `POST /api/v1/schedule` сохраняет `date`, `date_range`, `google_sheet_id`.
- `GET /api/v1/schedule?course=N&week=M` возвращает расписание без backend-фильтрации.
- `GET /api/v1/plan?course=N&semester=S` возвращает плановые показатели.
- `PUT /api/v1/plan` обновляет плановые показатели.
- CORS разрешает frontend origins.
- Есть механизм минимальной задержки обновлений: SSE/WebSocket или `GET /api/v1/schedule/updates` с `version`.
- После `POST /api/v1/schedule` меняется `version/updated_at`, и frontend может сразу refetch расписание.
- Ошибки возвращаются в JSON-формате.
