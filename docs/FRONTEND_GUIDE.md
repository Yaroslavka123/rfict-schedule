# Frontend guide

Документ описывает Svelte frontend в `rfict-schedule`: как запустить, как он получает данные, где лежит код и как проверить, что всё работает.

## Что делает frontend

Frontend — основное место для пользовательской логики:

- фильтры по курсу, неделе, группе, подгруппе, типу занятия и поиску;
- расписание по дням (плотная таблица с разделителями дней);
- матрица занятости кабинетов день × пара × кабинет (по образцу из приложенного HTML);
- список преподавателей и их занятий;
- план-факт аналитика по предмету: план / в расписании / проведено + редактируемый план;
- кнопка «Обновить» — пере-фетч расписания и плана через cache-busted запросы.

Backend (`https://rfict.up.railway.app`) — **единственный источник истины** для расписания, плана и событий обновления. Фронт не использует GitHub raw или локальные JSON-фикстуры — если backend недоступен, приложение покажет ошибку.

Для realtime backend должен отдавать SSE/WebSocket или version-endpoint — иначе frontend узнаёт о новом расписании только при ручном «Обновить».

## Технологии

- Svelte 5
- TypeScript
- Vite
- Tailwind CSS
- @lucide/svelte

## Установка Node.js и npm

`npm` ставится вместе с Node.js.

### Windows

Самый простой вариант — установить Node.js LTS:

```text
https://nodejs.org/en/download
```

После установки открыть PowerShell и проверить:

```bash
node -v
npm -v
```

Если нужен менеджер версий Node.js, можно поставить `nvm-windows`:

```text
https://github.com/coreybutler/nvm-windows/releases
```

Потом:

```bash
nvm install 22
nvm use 22
node -v
npm -v
```

### Linux

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v
npm -v
```

### macOS

```bash
brew install node
node -v
npm -v
```

## Первый запуск проекта

```bash
git clone https://github.com/Yaroslavka123/rfict-schedule.git
cd rfict-schedule
npm install
npm run dev
```

Открыть в браузере:

```text
http://localhost:5173
```

## Команды

```bash
npm install      # установить зависимости
npm run dev      # dev server Vite
npm run lint     # ESLint
npm run build    # svelte-check + TypeScript + production build
npm run preview  # локальный preview production build
```

После `npm run preview` открыть:

```text
http://localhost:4173
```

## Environment variables

Пример лежит в `.env.example`.

```bash
VITE_API_BASE_URL=https://rfict.up.railway.app
```

### `VITE_API_BASE_URL`

Backend base URL. Если переменная не задана — используется default `https://rfict.up.railway.app`. Других источников данных нет: если backend недоступен, приложение покажет ошибку.

## Источники данных

### Backend API (единственный)

```http
GET  /api/v1/schedule?course={course}     # расписание на все недели курса
GET  /api/v1/plan?course={course}         # план по предметам курса
PUT  /api/v1/plan                          # сохранить план: { course, subject, planned_pairs }
```

#### Ответ `/api/v1/schedule?course=N`

Frontend принимает любой из вариантов:

```ts
{ course: number, generated_at: string, groups: Group[], weeks: WeekSchedule[], lessons: Lesson[] }
```

или:

```ts
{ weeks: WeekSchedule[] }
```

или сразу массив недель:

```ts
WeekSchedule[]
```

Где `WeekSchedule`:

```ts
{
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

#### Ответ `/api/v1/plan?course=N`

```ts
{ plan: { course: number, subject: string, planned_pairs: number }[] }
```

или сразу массив:

```ts
{ course: number, subject: string, planned_pairs: number }[]
```

## Минимальная задержка обновлений

Чтобы расписание обновлялось почти сразу после изменения в Google Sheets, нужен такой поток:

```text
Apps Script parser → POST /api/v1/schedule → backend обновляет version
                                      ↓
frontend получает событие или видит новую version
                                      ↓
frontend refetch GET /api/v1/schedule?course=N&week=M
```

Лучший вариант — backend отдаёт SSE/WebSocket событие:

```http
GET /api/v1/schedule/events?course=3&week=14
```

или:

```http
WS /api/v1/schedule/live?course=3&week=14
```

Простой вариант для первого релиза — frontend polling раз в 5–10 секунд:

```http
GET /api/v1/schedule/updates?course=3&week=14
```

Если `version` или `updated_at` изменились, frontend заново загружает расписание. Без такого backend endpoint frontend не может узнать о новом расписании мгновенно.

## Главное поле для Google Sheets

Parser должен добавлять в каждое занятие:

```ts
google_sheet_id: string | null
```

Frontend строит ссылку:

```text
https://docs.google.com/spreadsheets/d/{google_sheet_id}/edit
```

Если `google_sheet_id` отсутствует, frontend показывает занятие без ссылки на Google таблицу.

## Структура frontend-кода

```text
src/
├── api/
│   └── scheduleClient.ts       # HTTP-клиент к backend API
├── components/
│   ├── layout/                 # shell и глобальные фильтры
│   └── ui/                     # базовые UI-компоненты
├── features/
│   ├── analytics/              # аналитика и план-факт на frontend
│   ├── rooms/                  # кабинетная матрица
│   ├── schedule/               # расписание по дням
│   └── teachers/               # преподаватели
├── stores/                     # scheduleStore, themeStore, columnGroups
├── lib/                        # расчёты, форматирование, utils
├── types/                      # TypeScript-типы расписания
├── App.svelte
└── main.ts
```

## Где менять основные вещи

| Что нужно изменить | Файл |
|---|---|
| Backend HTTP-клиент | `src/api/scheduleClient.ts` |
| Типы расписания | `src/types/schedule.ts` |
| Список курсов/недель/дней | `src/lib/constants.ts` |
| Расчёты, группировки, аналитика | `src/lib/schedule.ts` |
| Глобальные фильтры | `src/components/layout/GlobalFilters.svelte` |
| Вкладка расписания | `src/features/schedule/ScheduleView.svelte` |
| Вкладка кабинетов | `src/features/rooms/RoomsView.svelte` |
| Вкладка преподавателей | `src/features/teachers/TeachersView.svelte` |
| Вкладка аналитики | `src/features/analytics/AnalyticsView.svelte` |

## Как проверить локально

1. Установить зависимости:

```bash
npm install
```

2. Проверить lint:

```bash
npm run lint
```

3. Проверить production build:

```bash
npm run build
```

4. Запустить dev server:

```bash
npm run dev
```

5. Проверить в браузере:

- главная страница открывается;
- работает переключение светлой/тёмной темы;
- работают вкладки `Расписание`, `Кабинеты`, `Преподаватели`, `Аналитика`;
- работают фильтры курс/неделя/группа/подгруппа/тип/search;
- «Обновить» в шапке перезагружает расписание и план через cache-busted запросы к backend;
- если backend недоступен — появляется экран ошибки (это ожидаемо, fallback'ов нет).

## Как проверить новый backend domain

Безопасные read-only проверки:

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

`POST /api/v1/schedule` лучше проверять только на тестовой таблице/тестовом backend, чтобы не записать мусорные данные в production.

## Production build

```bash
npm run build
```

Результат появляется в:

```text
dist/
```

Для локальной проверки production build:

```bash
npm run preview
```
