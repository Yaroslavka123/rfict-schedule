# Запросы к backend-команде

Frontend должен делать максимум возможного сам: фильтры, группировки, вычисление факта, кабинетную матрицу, преподавательские представления и большую часть аналитики. Backend нужен как стабильный источник данных, справочников, плановых показателей и событий обновления.

## 1. Ответственность frontend

Frontend реализует без участия backend:

- фильтры по курсу, неделе, группе, типу занятия, преподавателю, аудитории и поиску;
- группировку расписания по дням, парам, группам, аудиториям, преподавателям;
- матрицу занятости кабинетов;
- поиск и карточки преподавателей;
- подсчёт фактических часов/пар из `lessons[]` с учётом `duration` и `cancelled`;
- сравнение план-факт, если backend отдаёт плановые показатели;
- визуализацию графиков/таблиц/CSV-экспорт;
- fallback на статические JSON из `/public/schedule`, если backend недоступен.

## 2. Ответственность backend

Backend должен хранить и отдавать только то, что frontend не должен держать локально:

- расписание, полученное от parser-а;
- справочники предметов, преподавателей, аудиторий и групп;
- плановые показатели как справочник/таблицу планов;
- `google_sheet_id` у занятий и плановых позиций;
- события обновления расписания для polling/WebSocket.

Backend repo `CourseJob` не меняется в этом frontend PR. Ниже — контракт, который нужно реализовать отдельно.

## 3. Новый production domain

Parser и frontend должны использовать backend:

```text
https://rfict.up.railway.app
```

В Apps Script parser-е это значение используется как default backend URL. При необходимости его можно переопределить через Script Properties:

```text
BACKEND_API_URL=https://rfict.up.railway.app
```

## 4. Расписание

### Получить расписание

```http
GET /api/v1/schedule?course=1&week=1
```

Ответ должен соответствовать текущему JSON parser-а:

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

`Lesson` должен включать все поля parser-а:

```ts
interface Lesson {
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

### Принять расписание от parser-а

Parser уже отправляет расписание на:

```http
POST /api/v1/schedule
```

Backend должен принять тот же `WeekSchedule`, сохранить его и вернуть `200` или `201`.

### Автосохранение текущей недели

`onSheetEdit()` отправляет на backend тот же `WeekSchedule`, что и ручная кнопка, но только для текущего листа-недели:

```http
POST /api/v1/schedule
```

Payload тот же, что у полного импорта:

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

Текущий CourseJob backend при `POST /api/v1/schedule` заменяет всю неделю: сначала удаляет старые `schedule_lesson` для недели, затем вставляет пришедшие `lessons[]`. Поэтому parser не должен отправлять в этот endpoint только одну изменённую ячейку — это удалит остальные занятия недели. Для true one-cell patch нужен отдельный backend endpoint или изменение semantics существующего `POST /api/v1/schedule`.

Backend должен вернуть `200`, `201` или `202`. После успешного autosave parser через 5 секунд обновляет справочники `teachers`, `rooms`, `subjects`.

## 5. Справочники

Parser использует эти endpoints для autocomplete:

```http
GET /api/v1/subjects
GET /api/v1/teachers
GET /api/v1/rooms
```

Желательно добавить/поддержать:

```http
GET /api/v1/groups
```

Минимально frontend/parser ожидает массивы с названиями или текущий формат backend-а, который уже используется в Apps Script.

## 6. Плановые показатели

Плановые показатели можно хранить как backend-справочник. Frontend будет брать план, считать факт из расписания и строить план-факт самостоятельно.

### Получить план

```http
GET /api/v1/plan?course=1&semester=2
```

### Сохранить план

```http
PUT /api/v1/plan
```

Минимальная сущность:

```ts
interface PlanEntry {
  id?: string
  course: number
  semester: number
  group: string
  subgroup: string | null
  subject: string
  type: string
  teacher: string | null
  google_sheet_id: string | null
  planned_pairs: number
}
```

`planned_pairs` — план в парах. Если backend хочет хранить часы, нужно явно договориться о коэффициенте пересчёта, но для текущего UI удобнее пары.

## 7. План-факт

Backend не обязан считать план-факт, если отдаёт `schedule` и `plan`. Frontend может посчитать:

```text
actual_pairs = sum(duration) по lessons, где cancelled=false
remaining_pairs = planned_pairs - actual_pairs
progress_percent = actual_pairs / planned_pairs * 100
```

Опциональный endpoint, если backend-команда всё же хочет отдавать готовую агрегацию:

```http
GET /api/v1/analytics/plan-fact?course=1&semester=2&week=1
```

Ответ:

```ts
interface PlanFactItem {
  group: string
  subgroup: string | null
  subject: string
  type: string
  teacher: string | null
  google_sheet_id: string | null
  planned_pairs: number
  actual_pairs: number
  remaining_pairs: number
  progress_percent: number
}
```

## 8. Обновления

Выбранный realtime-вариант — SSE, потому что frontend только слушает события и затем делает обычный refetch расписания.

```http
GET /api/v1/schedule/events?course=1&week=1
Accept: text/event-stream
```

Событие после `POST /api/v1/schedule`:

```text
event: schedule_updated
data: {"type":"schedule_updated","course":1,"week_number":1,"updated_at":"2026-05-17T20:00:00.000Z","version":"2026-05-17T20:00:00.000Z"}
```

Frontend подписывается через `EventSource`, на `schedule_updated` делает `GET /api/v1/schedule?course=N&week=M` и обновляет локальное состояние. Backend должен отправлять heartbeat раз в 20–30 секунд и разрешить CORS для SSE.

Fallback, если SSE временно недоступен:

```http
GET /api/v1/schedule/updates?since=2026-05-17T20:00:00.000Z
```

Ответ fallback polling:

```ts
interface ScheduleUpdateEvent {
  course: number
  semester: number
  week_number: number
  date_range: string
  generated_at: string
  lessons_count: number
  version: string
}
```

## 9. Проверка parser-а

Parser должен отправлять в backend JSON с:

- `course`
- `semester`
- `week_number`
- `date_range`
- `groups[]`
- `lessons[]`
- `lessons[].date`
- `lessons[].duration`
- `lessons[].cancelled`
- `lessons[].google_sheet_id`

После отправки backend должен вернуть `200` или `201`; иначе parser пишет warning в Apps Script logs.
