# rfict-schedule

Система управления расписанием **РФиКТ БГУ**. Apps Script расширение для Google Sheets + автоматический экспорт JSON в GitHub + webhook для Go backend.

## Архитектура

```
┌─────────────────┐    onEdit / Применить     ┌──────────────┐
│  Google Sheets   │ ──────────────────────── │  Apps Script  │
│  (расписание)    │                          │  (Code.gs)    │
└─────────────────┘                          └──────┬───────┘
                                                     │
                                          debounce 2 мин
                                                     │
                                    ┌────────────────┼────────────────┐
                                    ▼                                  ▼
                           ┌──────────────┐                  ┌──────────────┐
                           │   GitHub     │                  │  Go Backend   │
                           │  (JSON)      │                  │  (webhook)    │
                           └──────┬───────┘                  └──────────────┘
                                  │
                                  ▼
                           ┌──────────────┐
                           │  Frontend    │
                           │  (index.html)│
                           └──────────────┘
```

**Поток данных:**
1. Пользователь заполняет расписание через sidebar-форму или напрямую в ячейках
2. Apps Script (debounce 2 мин) генерирует JSON и пушит в GitHub
3. Apps Script вызывает webhook Go backend с метаданными обновления
4. Frontend читает JSON из GitHub Pages / raw GitHub

## Структура репозитория

```
rfict-schedule/
├── apps_script/labs_form/
│   ├── Code.gs            # Серверная логика: форма, парсинг, экспорт, webhook
│   ├── Sidebar.html       # UI формы ввода занятий
│   ├── appsscript.json    # Манифест Apps Script
│   └── README.md          # Документация Apps Script
├── public/
│   ├── index.html         # Фронтенд расписания (фильтры, поиск, тёмная тема)
│   └── schedule/
│       └── course_{N}/    # JSON файлы по курсам (1-4)
│           ├── 1.json     # Неделя 1
│           ├── 2.json     # Неделя 2
│           └── ...        # до 14.json
└── README.md
```

## Установка Apps Script

1. Открой таблицу расписания → **Расширения → Apps Script**
2. Создай файл `Code.gs` → вставь содержимое [`apps_script/labs_form/Code.gs`](apps_script/labs_form/Code.gs)
3. Создай файл `Sidebar.html` → вставь содержимое [`apps_script/labs_form/Sidebar.html`](apps_script/labs_form/Sidebar.html)
4. В **⚙ Project Settings** → включи **Show "appsscript.json"** → замени на [`appsscript.json`](apps_script/labs_form/appsscript.json)
5. Сохрани (Ctrl+S), обнови страницу таблицы

### Настройка автоэкспорта

1. **⚙ Project Settings → Script Properties:**
   - `GITHUB_TOKEN` — [Fine-grained PAT](https://github.com/settings/personal-access-tokens/new) с правами `Contents: Read and write` на репозиторий
   - `WEBHOOK_URL` *(опционально)* — URL Go backend endpoint для получения обновлений

2. **Triggers** (часы слева) → **Add Trigger:**
   - Function: `onSheetEdit`
   - Event source: From spreadsheet
   - Event type: On edit

### Автоэкспорт

При любом изменении в таблице (ручное или через форму) экспорт запускается автоматически с **debounce 2 минуты** — несколько быстрых правок → один пуш.

Ручной экспорт: **Расписание → Обновить расписание сейчас** (мгновенный, без задержки).

### 4 курса

Каждый курс — отдельная Google таблица со своим Apps Script. Курс определяется из ячейки `A2` (формат: `N курс`). JSON пушится в папку `public/schedule/course_{N}/`.

Для добавления нового курса: скопируй Apps Script + настрой `GITHUB_TOKEN` в новой таблице.

## Использование формы

- Меню **Расписание → Добавить / редактировать занятие** — открывает sidebar
- Выбери тип занятия (Лекция / Лаб / Практ / Семинар / Куратор / ДО)
- Для **лабы**: каждая подгруппа — отдельный блок (предмет, подгруппа, чет/нечет, препод, аудитория, даты, комментарий, отмена)
- Лаба пишется в 2 ячейки (текущая + ниже). Если 2 подгруппы — каждая в своей ячейке
- **Ctrl+Enter** — быстрое применение
- **↓ След.** — применить и перейти к следующей ячейке

---

## API для Go Backend

### Webhook: получение обновлений

Apps Script отправляет POST-запрос на `WEBHOOK_URL` после каждого успешного пуша JSON в GitHub.

#### `POST {WEBHOOK_URL}`

**Content-Type:** `application/json`

**Тело запроса (webhook payload):**

```json
{
  "event": "schedule_updated",
  "file": "public/schedule/course_3/14.json",
  "course": 3,
  "semester": 6,
  "week_number": 14,
  "date_range": "11.05-16.05",
  "name": "11.05-16.05(14-я неделя)",
  "generated_at": "2026-05-13T23:03:57.271Z",
  "lessons_count": 260
}
```

| Поле | Тип | Описание |
|------|-----|----------|
| `event` | `string` | Всегда `"schedule_updated"` |
| `file` | `string` | Путь к файлу в репозитории |
| `course` | `int` | Номер курса (1-4) |
| `semester` | `int` | Номер семестра |
| `week_number` | `int` | Номер недели (1-14) |
| `date_range` | `string` | Диапазон дат недели (`"ДД.ММ-ДД.ММ"`) |
| `name` | `string` | Название листа в таблице |
| `generated_at` | `string` | ISO 8601 timestamp генерации |
| `lessons_count` | `int` | Количество занятий в файле |

**Ожидаемый ответ:** `200 OK` (тело ответа игнорируется).

**Go handler example:**

```go
type WebhookPayload struct {
    Event        string `json:"event"`
    File         string `json:"file"`
    Course       int    `json:"course"`
    Semester     int    `json:"semester"`
    WeekNumber   int    `json:"week_number"`
    DateRange    string `json:"date_range"`
    Name         string `json:"name"`
    GeneratedAt  string `json:"generated_at"`
    LessonsCount int    `json:"lessons_count"`
}

func handleWebhook(w http.ResponseWriter, r *http.Request) {
    var payload WebhookPayload
    if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
        http.Error(w, "bad request", 400)
        return
    }

    // Скачать обновлённый JSON из GitHub
    rawURL := fmt.Sprintf(
        "https://raw.githubusercontent.com/Yaroslavka123/rfict-schedule/main/%s",
        payload.File,
    )
    // fetch rawURL → parse → save to DB / cache
    
    w.WriteHeader(http.StatusOK)
}
```

### JSON Schema: файл недели

Каждый файл `public/schedule/course_{N}/{week}.json` содержит полное расписание одной недели.

**Путь:** `public/schedule/course_{course}/{week_number}.json`

```json
{
  "name": "11.05-16.05(14-я неделя)",
  "generated_at": "2026-05-13T23:03:57.271Z",
  "course": 3,
  "semester": 6,
  "week_number": 14,
  "date_range": "11.05-16.05",
  "groups": [ ... ],
  "lessons": [ ... ]
}
```

#### Корневые поля

| Поле | Тип | Описание |
|------|-----|----------|
| `name` | `string` | Название листа |
| `generated_at` | `string` | ISO 8601 timestamp |
| `course` | `int` | Номер курса (1-4) |
| `semester` | `int` | Номер семестра |
| `week_number` | `int` | Номер недели (1-14) |
| `date_range` | `string` | Диапазон дат (`"ДД.ММ-ДД.ММ"`) |
| `groups` | `Group[]` | Список групп |
| `lessons` | `Lesson[]` | Все занятия недели |

#### Group

```json
{
  "id": "601",
  "name": "Группа 601",
  "specialty": "Безопасность компьютерных технологий и систем",
  "department": "КБ"
}
```

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | `string` | Идентификатор группы |
| `name` | `string` | Отображаемое название |
| `specialty` | `string` | Специальность |
| `department` | `string` | Кафедра (`"РФиИТ"`, `"КБ"`, `"ПИ"`) |

#### Lesson

```json
{
  "day": "Пн",
  "day_number": 1,
  "pair": 1,
  "duration": 2,
  "time": "09:00 - 10:25",
  "group": "5",
  "type": "lab",
  "subject": "БИС",
  "teacher": "ст.пр. ПопкоЕ.Е.",
  "room": "708",
  "subgroup": "1ПГ/2ПГ нечет/чет",
  "frequency": "нечет/чет",
  "period_start": "13.04",
  "period_end": "05.05",
  "comment": "608 на 15.05",
  "cancelled": false
}
```

| Поле | Тип | Nullable | Описание |
|------|-----|----------|----------|
| `day` | `string` | нет | День недели (`"Пн"`, `"Вт"`, `"Ср"`, `"Чт"`, `"Пт"`, `"Сб"`) |
| `day_number` | `int` | нет | Номер дня (1=Пн, 6=Сб) |
| `pair` | `int` | нет | Номер пары (1-8) |
| `duration` | `int` | нет | Длительность в парах (1, 2 или 3) |
| `time` | `string` | нет | Время начала и конца (см. таблицу звонков) |
| `group` | `string` | нет | ID группы (соответствует `groups[].id`) |
| `type` | `string` | нет | Тип занятия (см. enum ниже) |
| `subject` | `string` | нет | Название предмета |
| `teacher` | `string` | да | ФИО преподавателя с должностью |
| `room` | `string` | да | Номер аудитории |
| `subgroup` | `string` | да | Подгруппа (`"1ПГ"`, `"2ПГ"`, `"1ПГ/2ПГ нечет/чет"`) |
| `frequency` | `string` | да | Частота (`"чет"`, `"нечет"`, `"нечет/чет"`, `"еженедельно"`) |
| `period_start` | `string` | да | Дата начала периода (`"ДД.ММ"`) |
| `period_end` | `string` | да | Дата конца периода (`"ДД.ММ"`) |
| `comment` | `string` | да | Комментарий |
| `cancelled` | `bool` | нет | Занятие отменено (`ОТМЕНА`) |

#### Enum: `type`

| Значение | Цвет ячейки | Описание |
|----------|-------------|----------|
| `lecture` | `#d9ead3` (зелёный) | Лекция |
| `lab` | `#fce5cd` (оранжевый) | Лабораторная |
| `practice` | `#c9daf8` (голубой) | Практика |
| `seminar` | `#ffffff` (белый) | Семинар |
| `curator_hour` | `#fff2cc` (жёлтый) | Кураторский час |
| `additional` | `#d9d2e9` (фиолетовый) | ДО / дополнительное |

#### Расписание звонков

| Пара | Время |
|------|-------|
| 1 | 09:00 - 10:25 |
| 2 | 10:35 - 12:00 |
| 3 | 12:10 - 13:35 |
| 4 | 14:00 - 15:25 |
| 5 | 15:35 - 17:00 |
| 6 | 17:20 - 18:45 |
| 7 | 18:55 - 20:20 |
| 8 | 20:30 - 21:55 |

> При `duration > 1` поле `time` содержит время первой пары. Фактическое окончание = время конца пары `pair + duration - 1`.

### Рекомендуемые Go endpoints

На основе структуры данных, рекомендуемые REST endpoints для Go backend:

#### Расписание

```
GET /api/v1/schedule
    ?course=3              # фильтр по курсу (1-4)
    &week=14               # фильтр по неделе (1-14)
    &group=601             # фильтр по группе
    &day=Пн                # фильтр по дню
    &type=lab              # фильтр по типу занятия
    &teacher=Яцков         # поиск по преподавателю (substring)
    &subject=БИС           # поиск по предмету (substring)
```

**Response:**
```json
{
  "lessons": [ ... ],
  "total": 42,
  "filters": {
    "course": 3,
    "week": 14,
    "group": "601"
  }
}
```

#### Группы

```
GET /api/v1/groups
    ?course=3              # фильтр по курсу
    &department=КБ         # фильтр по кафедре
```

**Response:**
```json
{
  "groups": [
    {
      "id": "601",
      "name": "Группа 601",
      "specialty": "Безопасность компьютерных технологий и систем",
      "department": "КБ",
      "course": 3
    }
  ]
}
```

#### Недели

```
GET /api/v1/weeks
    ?course=3
```

**Response:**
```json
{
  "weeks": [
    {
      "week_number": 14,
      "date_range": "11.05-16.05",
      "name": "11.05-16.05(14-я неделя)",
      "lessons_count": 260,
      "updated_at": "2026-05-13T23:03:57.271Z"
    }
  ]
}
```

#### Текущее расписание (для студента)

```
GET /api/v1/schedule/current
    ?group=601
```

Автоматически определяет текущую неделю по дате и возвращает расписание на сегодня/эту неделю.

#### Webhook endpoint

```
POST /api/v1/webhook/schedule
```

Принимает webhook от Apps Script (см. [Webhook payload](#post-webhook_url)).
При получении — скачивает обновлённый JSON из GitHub и обновляет кэш/БД.

#### Go struct для Lesson

```go
type Lesson struct {
    Day         string  `json:"day"`
    DayNumber   int     `json:"day_number"`
    Pair        int     `json:"pair"`
    Duration    int     `json:"duration"`
    Time        string  `json:"time"`
    Group       string  `json:"group"`
    Type        string  `json:"type"`
    Subject     string  `json:"subject"`
    Teacher     *string `json:"teacher"`
    Room        *string `json:"room"`
    Subgroup    *string `json:"subgroup"`
    Frequency   *string `json:"frequency"`
    PeriodStart *string `json:"period_start"`
    PeriodEnd   *string `json:"period_end"`
    Comment     *string `json:"comment"`
    Cancelled   bool    `json:"cancelled"`
}

type Group struct {
    ID         string `json:"id"`
    Name       string `json:"name"`
    Specialty  string `json:"specialty"`
    Department string `json:"department"`
}

type WeekSchedule struct {
    Name        string   `json:"name"`
    GeneratedAt string   `json:"generated_at"`
    Course      int      `json:"course"`
    Semester    int      `json:"semester"`
    WeekNumber  int      `json:"week_number"`
    DateRange   string   `json:"date_range"`
    Groups      []Group  `json:"groups"`
    Lessons     []Lesson `json:"lessons"`
}
```

### Получение JSON из GitHub

Для скачивания JSON напрямую из GitHub (без webhook):

```
https://raw.githubusercontent.com/Yaroslavka123/rfict-schedule/main/public/schedule/course_{N}/{week}.json
```

Пример:
```
https://raw.githubusercontent.com/Yaroslavka123/rfict-schedule/main/public/schedule/course_3/14.json
```

> **Rate limit:** GitHub raw content не имеет строгого rate limit, но для production рекомендуется кэшировать данные на стороне backend и обновлять по webhook.

### Список всех файлов

```
https://api.github.com/repos/Yaroslavka123/rfict-schedule/contents/public/schedule/course_3
```

Вернёт массив файлов (`1.json`..`14.json`) с их SHA и download URL.
