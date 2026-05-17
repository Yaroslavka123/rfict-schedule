# Запросы к backend-команде

Frontend реализован backend-first: при наличии `VITE_API_BASE_URL` он сначала обращается к backend, а при ошибке использует JSON из `/public/schedule`.

## Контракт расписания

Нужен endpoint:

```http
GET /api/v1/schedule?course=1&week=1
```

Ответ должен соответствовать `WeekSchedule`:

```ts
interface WeekSchedule {
  name: string
  generated_at: string
  course: number
  semester: number
  week_number: number
  date_range: string
  groups: Group[]
  lessons: Lesson[]
}
```

В `Lesson` frontend ожидает текущие поля parser-а плюс:

```ts
google_sheet_id: string | null
```

## План-факт

Нужны endpoints:

```http
GET /api/plan?course=1&semester=2
PUT /api/plan
GET /api/analytics/plan-fact?course=1&week=1
```

Минимальная сущность плана:

```ts
interface PlanEntry {
  course: number
  group: string
  subgroup: string | null
  subject: string
  type: string
  teacher: string | null
  google_sheet_id: string | null
  planned_pairs: number
}
```

## Обновления

Для live-обновлений нужен один из вариантов:

```http
GET /api/v1/schedule/updates?since=...
```

или WebSocket:

```http
/ws/updates
```

Событие должно содержать `course`, `week_number`, `date_range`, `generated_at`, `lessons_count`.
