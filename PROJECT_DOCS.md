# rfict-schedule — Документация проекта

Подробное описание каждого файла, его ответственности и связей с другими модулями.

---

## Содержание

- [1. Frontend (src/)](#1-frontend-src)
  - [1.1 Входная точка](#11-входная-точка)
  - [1.2 Типы](#12-типы)
  - [1.3 API слой](#13-api-слой)
  - [1.4 Бизнес-логика](#14-бизнес-логика)
  - [1.5 Утилиты](#15-утилиты)
  - [1.6 Константы](#16-константы)
  - [1.7 Сторы (state management)](#17-сторы-state-management)
  - [1.8 Компоненты](#18-компоненты)
  - [1.9 Фичи (вкладки)](#19-фичи-вкладки)
  - [1.10 Стили](#110-стили)
- [2. Apps Script (apps_script/)](#2-apps-script-apps_script)
  - [2.1 Code.gs](#21-codegs)
  - [2.2 Generator.gs](#22-generatorgs)
  - [2.3 Template.gs](#23-templategs)
  - [2.4 BundledTemplate.gs](#24-bundledtemplategs)
  - [2.5 Sidebar.html](#25-sidebarhtml)
  - [2.6 GeneratorDialog.html](#26-generatordialoghtml)
  - [2.7 appsscript.json](#27-appsscriptjson)
- [3. Документация (docs/)](#3-документация-docs)
- [4. Конфигурация](#4-конфигурация)

---

## 1. Frontend (`src/`)

### 1.1 Входная точка

#### `src/main.ts`
Инициализация Svelte-приложения. Монтирует `App` в `#root`. Импортирует `index.css` для Tailwind.

```typescript
mount(App, { target: document.getElementById('root')! })
```

#### `src/App.svelte`
Главный компонент-оркестратор:
- Управляет **активной вкладкой** (`activeTab: AppTab`)
- Хранит **состояние фильтров** (`filters: FiltersState`)
- Debounce поиска (200ms) через `$effect`
- Debounce fetch курса (100ms)
- Авто-определение текущей недели (`findCurrentWeek`)
- Условный рендер: монтируется только активная вкладка (`{#if activeTab === '...'}`)
- Обработка состояний: загрузка, ошибка, пусто

**Связи:**
- → `scheduleStore` — чтение данных
- → `themeStore` — тёмная/светлая тема
- → `TopFilters` — фильтры
- → `AppShell` — шаблон страницы
- → Все 4 `*View` — контент вкладок

---

### 1.2 Типы

#### `src/types/schedule.ts`
Все TypeScript-типы данных. 129 строк, **без импортов из других файлов проекта**.

**Ключевые типы:**

| Тип | Описание |
|-----|----------|
| `LessonType` | `'lecture' \| 'lab' \| 'practice' \| 'seminar' \| 'curator_hour' \| 'additional' \| 'unknown'` |
| `ScheduleLesson` | Занятие: день, пара, предмет, преподаватель, аудитория, подгруппа, отмена |
| `ScheduleGroup` | Группа: id, name, specialty, department |
| `WeekSchedule` | Неделя: номер, даты, группа, список занятий |
| `CourseSchedule` | Весь курс: course, weeks, lessons, groups |
| `MergedSchedule` | Все курсы вместе (для `course='all'`) |
| `FiltersState` | Состояние фильтров: course, week, group, subgroup, lessonTypes, search |
| `CoursePlanMap` | План: `Record<string, number>` (subject → planned_pairs) |
| `AnalyticsCell` | Ячейка аналитики: planned, scheduled, done |
| `AnalyticsGroup` / `AnalyticsSubgroup` / `AnalyticsRow` | Иерархия план-факта |
| `SubjectPlanRow` / `SubjectPlanGroup` / `SubjectPlanSubgroup` | Альтернативная иерархия (subject-first) |
| `PlanFactCourse` / `PlanFactGroup` / `PlanFactSubgroup` / `PlanFactSubject` | Третья иерархия (course-first, используется в AnalyticsView) |

**Внимание:** 3 разные иерархии аналитики — кандидат на рефакторинг.

---

### 1.3 API слой

#### `src/api/scheduleClient.ts`
HTTP-клиент к Go backend. 312 строк, **чистый TypeScript без Svelte**.

**Функции:**

| Функция | Описание |
|---------|----------|
| `fetchJson<T>(url, init?)` | Базовый fetch с `cache: 'no-store'`, проверка статуса |
| `bust(url)` | Добавляет `?t=Timestamp` для кэш-бастинга |
| `trimLesson(lesson)` | Удаляет null/undefined/пустые строки из объекта занятия |
| `loadCourseSchedule(course, options?)` | GET `/api/v1/schedule?course=N` → `CourseSchedule` |
| `loadCoursePlan(course, options?)` | GET `/api/v1/plan?course=N` → `CoursePlanMap` |
| `loadCourseBundle(course, options?)` | Параллельный fetch schedule + plan |
| `loadAllCoursesBundle(options?)` | `Promise.all` по всем 4 курсам → `MergedSchedule` |
| `saveCoursePlanEntry(entry)` | PUT `/api/v1/plan` |
| `planKey(subject, type?)` | Генерирует ключ для плана (`subject::type`) |
| `planSubjectForType(subject, type?)` | Форматирует subject с типом для отображения |

**Нормализация ответов:**
- `normalizeCourseResponse()` — принимает 3 формата ответа от бэкенда
- `normalizePlanResponse()` — принимает 4 варианта обёртки

**Константы:**
- `API_BASE_URL` — из `VITE_API_BASE_URL` или `'https://rfict.up.railway.app'`
- `SUPPORTED_COURSES` — `[1, 2, 3, 4]`

---

### 1.4 Бизнес-логика

#### `src/lib/schedule.ts`
Все чистые функции трансформации данных. 655 строк, **без Svelte-маркапа**.

**Фильтрация:**

| Функция | Описание |
|---------|----------|
| `applyLessonFilters(lessons, groups, filters, search)` | Основной фильтр: группа, подгруппа, тип, текстовый поиск |
| `isLessonActiveForWeek(lesson)` | Проверяет, активно ли занятие на текущей неделе (чёт/нечёт) |
| `matchesSubgroup(lesson, target)` | Проверяет, относится ли занятие к целевой подгруппе |
| `getActiveSubgroupsForLesson(lesson)` | Возвращает активные подгруппы с учётом чётности недели |
| `getSubgroupsForGroup(lessons, groupId)` | Все уникальные подгруппы для группы |

**Расписание:**

| Функция | Описание |
|---------|----------|
| `groupLessonsByDay(lessons)` | Группировка по дням недели (Пн-Вс) |
| `buildStats(lessons)` | Статистика: всего, лекций, лаб, практик, отмен |
| `getPairRange(lesson)` | Диапазон пар (`1-2`) |
| `getGoogleSheetUrl(lesson)` | Ссылка на Google Sheets |
| `getGroupNameById(groups, groupId)` | Имя группы по id |

**Комнаты:**

| Функция | Описание |
|---------|----------|
| `normalizeRoom(room)` | Нормализация номера аудитории |
| `categorizeRoom(room)` | Категория: лекционный зал, комп. класс, кабинет |
| `getRooms(lessons)` | Уникальные аудитории, отсортированные по категории |
| `findRoomLessons(lessons, room, day, pair)` | Занятия в комнате в заданный слот |

**Преподаватели:**

| Функция | Описание |
|---------|----------|
| `normalizeTeacherName(name)` | Тримминг пробелов |
| `buildTeacherSummaries(lessons)` | Сводка: преподаватель → занятия, конфликты, комнаты |
| `findTeacherConflicts(lessons)` | Конфликты: пересечения по времени |
| `getBusyPairsForTeacher(lessons)` | Занятые слоты преподавателя |
| `getTeacherLessonAt(lessons, day, pair)` | Занятия преподавателя в слоте |

**Аналитика:**

| Функция | Описание |
|---------|----------|
| `buildCourseAnalytics({plan, groups, lessons})` | Аналитика по курсу (group-first иерархия) |
| `buildSubjectPlanRows({plan, groups, lessons})` | Аналитика по предметам (subject-first) |
| `buildPlanFactHierarchy({courses, groups, lessons, plans})` | Основная иерархия для AnalyticsView (course-first) |
| `getCourseSubjects(lessons)` | Уникальные предметы курса |
| `statusColor(cell)` | Цвет статуса: зелёный (ок), оранжевый (перебор), красный (недобор) |
| `progress(cell)` | Процент выполнения плана |

**Паритет (чёт/нечёт):**

| Функция | Описание |
|---------|----------|
| `isEvenWeek(weekNumber)` | Чётная ли неделя |
| `detectParity(weekNumbers)` | Определение паритета: 'even', 'odd', 'mixed', 'none' |
| `getActiveSubgroupsForLesson(lesson)` | Активные подгруппы с учётом frequency (нечет/чет/еженедельно) |

---

### 1.5 Утилиты

#### `src/lib/utils.ts`
73 строк. Общие утилиты.

| Функция | Описание |
|---------|----------|
| `cn(...inputs)` | Условное объединение классов (tailwind-merge не используется намеренно) |
| `pluralPair(value)` | Склонение «пара/пары/пар» |
| `formatUpdatedAt(iso)` | «обновлено 5 мин назад» |
| `normalizeText(value)` | Текст в нижний регистр, ё→е, trim; с кэшем |
| `normalizeForTeacherSearch(value)` | Упрощённый поиск преподавателя (стяжение званий) |

---

### 1.6 Константы

#### `src/lib/constants.ts`
40 строк. Все константы приложения.

| Константа | Значение |
|-----------|----------|
| `LESSON_TYPE_LABELS` | `{ lecture: 'Лекция', lab: 'Лаба', practice: 'Практика', ... }` |
| `LESSON_TYPE_TONES` | `{ lecture: 'green', lab: 'orange', ... }` |
| `DAY_ORDER` | `['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']` |
| `PAIRS` | `[1, 2, 3, 4, 5, 6, 7, 8]` |
| `PAIR_TIMES` | `{ 1: '8:30 – 10:00', 2: '10:10 – 11:40', ... }` |
| `ACTIVE_COURSE` | `3` (курс по умолчанию) |
| `COURSES` | `[1, 2, 3, 4]` |
| `WEEKS` | `[1, 2, ..., 18]` |
| `LECTURE_HALLS` | `['115', '117', '119']` |

---

### 1.7 Сторы (state management)

#### `src/stores/scheduleStore.ts`
600 строк. Главный стор: fetch, кэш, optimistic updates.

**Структура:**

```typescript
interface ScheduleState {
  schedule: CourseSchedule | MergedSchedule | null
  index: ScheduleIndex          // pre-computed индексы
  plan: CoursePlanMap           // объединённый план
  plans: Record<number, CoursePlanMap>  // планы по курсам
  loading: boolean
  error: string | null
  loadedAt: number
}
```

**ScheduleIndex** — pre-computed индексы для O(1) доступа:
- `weeksByNumber` — недели по номерам
- `lessonsByWeek` — занятия по неделям
- `roomOccupancyByWeek` — occupancy матрицы комнат по неделям
- `teacherOccupancyByWeek` — occupancy матрицы преподавателей по неделям
- `groupNameById` — Map id → name

**Кэширование:**
- LocalStorage с версионностью (`rfict-cache-v3-course-{N}`)
- In-memory cache (`Map<string, CachedBundle>`) — быстрее JSON.parse
- Debounced запись в localStorage (300ms)
- TTL: 15 минут
- Stale-while-revalidate: показываем кэш, фоном обновляем

**RoomOccupancyIndex / TeacherOccupancyIndex:**
Pre-computed структуры для матриц:
- `orderedRooms` / `orderedTeachers` — порядок колонок
- `categoryByRoom` / `categoryStart` — категории для визуального разделения
- `occupancy` — `[room][day][pair] → RoomCell` — ячейки матрицы

**Методы:**
- `fetch(course, force?)` — загрузка + кэширование
- `refresh()` — принудительный refetch
- `updatePlan(entry)` — optimistic update + PUT + rollback

#### `src/stores/themeStore.ts`
25 строк. Тёмная/светлая тема.

- `writable<'dark' | 'light'>`
- Инициализация из localStorage → `prefers-color-scheme`
- `toggleTheme()` — переключение
- Подписка: `document.documentElement.classList.toggle('dark')`

#### `src/stores/columnGroups.ts`
103 строк. Группировка колонок матриц.

**ColumnGroup:** `{ id, name, items[], collapsed, isBuiltIn }`

**Методы:**
- `addGroup(scope, name)`
- `removeGroup(scope, id)` — нельзя удалить built-in
- `renameGroup(scope, id, name)`
- `addItem / removeItem` — управление элементами группы
- `reorder(scope, fromIdx, toIdx)` — перетаскивание
- `toggleCollapse(scope, id)`

**Persist:** localStorage (`rfict-room-groups`, `rfict-teacher-groups`)

**Статус:** ✅ Существует, ❌ НЕ подключён к матрицам (RoomsView, TeachersView).

---

### 1.8 Компоненты

#### `src/components/layout/AppShell.svelte`
138 строк. Главный шаблон страницы.

- **Header:** логотип, название «РФиКТ», навигация (4 таба)
- **Кнопки:** «Обновить», тема (☀/🌙), «обновлено N мин назад»
- **Слот `controls`** — фильтры (TopFilters)
- **Слот `children`** — контент вкладки

#### `src/components/layout/TopFilters.svelte`
144 строк. Горизонтальные фильтры в шапке (заменил GlobalFilters).

**Фильтры:**
- **Курс** — `<select>` со всеми курсами + «Все курсы»
- **Группа** — фильтруется по курсу, показывает номер курса если `course='all'`
- **Неделя** — `<select>` с номерами (скрыт на план-факте)
- **Тип занятия** — `<select>` с типами (Lectures, Labs, Practice...)
- **Поиск** — `<input>` с иконкой поиска
- **Сбросить** — кнопка ✕ (показывается если есть активные фильтры)

**Отличия от GlobalFilters:**
- TopFilters — горизонтальная строка в шапке
- GlobalFilters — вертикальный сайдбар (не используется, но существует)

**Баг:** `<select>` не отображает выбранное значение после закрытия (см. Roadmap B1).

#### `src/components/layout/GlobalFilters.svelte`
187 строк. Вертикальный сайдбар фильтров.

**Не используется в текущей версии.** Заменён на TopFilters. Содержит расширенные фильтры: подгруппа, неделя кнопками, тип занятия чипсами. Может быть возвращён для десктопной версии.

#### `src/components/ui/Button.svelte`
Кнопка с вариантами: `primary`, `secondary`, `ghost`. Принимает `className` для Tailwind.

#### `src/components/ui/Card.svelte`
Контейнер с закруглением, границей, фоном. Слоты: `header`, `content`.

#### `src/components/ui/Input.svelte`
Обёртка `<input>` с Tailwind-стилями.

#### `src/components/ui/Highlight.svelte`
Подсветка текста по поисковому запросу. Разбивает текст на части и оборачивает совпадения в `<mark>`.

---

### 1.9 Фичи (вкладки)

#### `src/features/schedule/ScheduleView.svelte`
154 строк. Дневное расписание.

**Логика:**
- `groupByDay()` — группировка по дням
- `buildStats()` — статистика (всего, лекций, лаб, отмен)
- `periodFor()` — форматирование периода (с... по...)
- Рендер таблицы: день → пара → тип → предмет → преподаватель → аудитория → группа → подгруппа

**Фишки:**
- Отменённые занятия — `opacity-50` + `line-through`
- Ссылка на Google Sheets (иконка ExternalLink)
- Адаптивная таблица (scroll-x)

#### `src/features/rooms/RoomsView.svelte`
325 строк. Матрица занятости кабинетов.

**Логика:**
- 6 дней × 8 пар × N комнат
- Pre-computed `RoomOccupancyIndex` из store (O(1) доступ по неделе)
- `filterRoomData()` — фильтрация по группе, типу, поиску
- Категоризация комнат: лекционные залы (saddlebrown), комп. классы (синие), кабинеты (зелёные)

**Тултип:**
- При наведении на ячейку — показывает: предмет, преподаватель, группа, время
- Event delegation: 1 обработчик `onpointerover` на `<table>` вместо 1900

**Зависимость:** `RoomOccupancyIndex` из `scheduleStore`

#### `src/features/teachers/TeachersView.svelte`
250 строк. Матрица занятости преподавателей.

**Логика:**
- 6 дней × 8 пар × N преподавателей
- Pre-computed `TeacherOccupancyIndex` из store
- `filterTeacherData()` — фильтрация по типу занятия
- Поиск: подсветка совпадений (`slot-match`) + затемнение несовпадений (`slot-dim`)
- Vertical labels на заголовках (`writing-mode: vertical-rl`)

**Тултип:** аналогично RoomsView

#### `src/features/analytics/AnalyticsView.svelte`
347 строк. План-факт аналитика.

**Логика:**
- `buildPlanFactHierarchy()` — построение иерархии курс → группа → подгруппа → предмет
- Редактируемые поля плана для каждого предмета + кнопка Save
- `today` реактивный (обновляется каждые 60 сек)
- `exportCsv()` — экспорт в CSV с BOM

**Проблемы:**
- Баг отображения предметов (см. Roadmap B3)
- Сохранение плана может не работать (silent rollback, см. B4)
- Нет оверрайда на группу (будет в Фазе 3)

---

### 1.10 Стили

#### `src/index.css`
598 строк. Tailwind + кастомные компоненты.

**CSS переменные (HSL):**
- Светлая тема: `--background: 210 24% 98%`
- Тёмная тема: `--background: 220 18% 9%`

**Кастомные компоненты:**
- `.app-shell`, `.app-header`, `.app-tabs` — шапка
- `.filter-chip`, `.filter-chip-active` — чипсы фильтров
- `.dense-table` — таблица расписания
- `.type-badge`, `.type-{lecture|lab|practice|...}` — бейджи типов
- `.room-matrix`, `.teachers-matrix` — матрицы
- `.slot-cell`, `.slot-busy`, `.slot-free` — ячейки матриц
- `.slot-type-{lecture|lab|...}` — цвета типов в матрицах
- `.plan-table`, `.plan-input`, `.plan-progress` — аналитика
- `.slot-tooltip` — тултипы

---

## 2. Apps Script (`apps_script/`)

### 2.1 Code.gs
**Файл:** `apps_script/labs_form/Code.gs` (1705 строк)

**Ответственность:** парсинг Google Sheets, меню, сайдбар, экспорт в GitHub + backend.

**Структура:**

| Раздел | Строки | Описание |
|--------|--------|----------|
| Константы | 1-46 | Типы занятий, настройки GitHub, backend URL |
| Меню и sidebar | 51-127 | `onOpen`, `showSidebar`, `togglePushEnabled` |
| Клиент → сервер | 128-230 | `getActiveCellInfo`, `getDictionaries`, `fetchDictionariesFromBackend_` |
| Применение формы | 237-408 | `applyLesson`, `buildCellContent_`, `applyRichTextToCell_` |
| Утилиты парсинга | 501-838 | `formatTeacherName_`, `parseCellContent_`, `detectLessonType_` |
| Автосохранение | 840-1145 | `onSheetEdit`, `scheduleDelayedExport_`, `dispatchScheduleUpdate_` |
| Экспорт JSON | 1147-1321 | `parseWeekSheet_`, `discoverGroups_`, `exportAllSheets_`, `pushSheet_` |
| Парсинг RichText | 1322-1653 | `parseRichLessonCell_`, `buildStyleMap_`, `extractPeriod_` |
| GitHub API | 1655-1705 | `pushFileToGitHub_`, `testDispatch` |

**Ключевые функции:**

| Функция | Описание |
|---------|----------|
| `onOpen()` | Создаёт меню «Расписание» с 8 пунктами |
| `showSidebar()` | Открывает sidebar с формой ввода занятия |
| `getActiveCellInfo()` | Возвращает данные ячейки + словари за 1 roundtrip |
| `applyLesson(data)` | Записывает занятие в ячейку (RichText + цвет + мерж) |
| `applyLessonAndMoveDown(data)` | `applyLesson` + перевод курсора вниз |
| `clearActiveCell()` | Очистка ячейки |
| `onSheetEdit(e)` | Installable trigger: при редактировании → debounce экспорт |
| `scheduleDelayedExport_()` | Debounce 2 мин перед экспортом |
| `dispatchScheduleUpdate_()` | Экспорт JSON в GitHub + webhook |
| `parseWeekSheet_(sheet, groups)` | Парсинг листа-недели в массив занятий |
| `parseRichLessonCell_(richText, roomValue)` | Парсинг RichText ячейки |
| `pushFileToGitHub_(path, content, token)` | PUT через GitHub Contents API |

**Проблемные места:**
- `ensureSingleEditTrigger_()` (строка 1084) — дубли триггеров
- `buildAutosaveScheduleForRange_()` — нестабильный парсинг при частичных данных
- `parseRichLessonCell_()` (строка 1521) — сложная логика на 85 строк

---

### 2.2 Generator.gs
**Файл:** `apps_script/labs_form/Generator.gs` (398 строк)

**Ответственность:** генерация пустых листов семестра по шаблону.

**Ключевые функции:**

| Функция | Описание |
|---------|----------|
| `openSemesterGenerator()` | Открывает диалог генератора |
| `getGeneratorDefaults()` | Дефолтные параметры + источник шаблона |
| `runSemesterGenerator(rawParams)` | Главный entrypoint: создаёт N листов недель |
| `computeSemesterStart_(year, semester)` | Понедельник начала семестра |
| `computeBellSchedule_(params)` | Расчёт расписания звонков |
| `customizeWeekSheet_(sheet, template, ...)` | Заполнение листа данными недели |
| `analyzeTemplateStructure_(template)` | Анализ структуры шаблона (мержи, пары) |

**Дефолты генератора:**
```javascript
GENERATOR_DEFAULTS_ = {
  year: null, course: 1, semester: 1,
  pair_min: 85, break_min: 10, first_start: '09:00',
  lunch_after: 3, lunch_min: 30,
  num_weeks: 18, num_pairs: 8, days_per_week: 6,
  date_format: 'short'
}
```

**Фаза 1.3:** дефолты нужно изменить на `first_start: '08:30'`, `pair_min: 90`, учесть БП.

---

### 2.3 Template.gs
**Файл:** `apps_script/labs_form/Template.gs` (213 строк)

**Ответственность:** загрузка и применение шаблона листа.

| Функция | Описание |
|---------|----------|
| `loadTemplate_()` | Загрузка шаблона из `BUNDLED_TEMPLATE_JSON_` |
| `applyTemplate_(sheet, template)` | Воспроизводит лист из шаблона (размеры, стили, мержи) |
| `buildRichTextValue_(obj)` | Восстанавливает RichText из JSON |
| `applyDefaultBorders_(sheet, template)` | Рисует сетку расписания |

---

### 2.4 BundledTemplate.gs
**Файл:** `apps_script/labs_form/BundledTemplate.gs` (29 строк)

Содержит `BUNDLED_TEMPLATE_JSON_` — JSON-слепок эталонного листа расписания (сериализованный шаблон со стилями, мержами, RichText).

Размер: ~50-200 КБ. Генерируется через меню «Экспортировать шаблон в код».

---

### 2.5 Sidebar.html
**Файл:** `apps_script/labs_form/Sidebar.html` (1114 строк)

HTML+CSS+JS для боковой панели ввода занятия.

**Структура:**
- CSS (строки 1-275): переменные, кнопки типов, autocomplete, блоки подгрупп
- HTML (строки 277-353): форма
- JavaScript (строки 355-1114): state management, autocomplete, валидация

**Ключевые JS-функции:**

| Функция | Описание |
|---------|----------|
| `init()` | Загрузка данных ячейки, заполнение формы |
| `selectType(code)` | Выбор типа занятия, авто-spanRows |
| `switchToMulti()` | Переключение в мульти-режим (лаба с подгруппами) |
| `addSubgroupBlock()` | Добавление блока подгруппы |
| `setupAutoComplete()` | Autocomplete для input |
| `collectFormData()` | Сбор данных формы → объект для applyLesson |
| `onSubmit()` | Отправка на сервер (google.script.run) |
| `validateForm()` | Включение/отключение кнопки «Применить» |

---

### 2.6 GeneratorDialog.html
**Файл:** `apps_script/labs_form/GeneratorDialog.html` (198 строк)

Модальный диалог для генератора семестра. Поля:
- Учебный год, курс, семестр
- Количество недель, дней в неделе
- Формат даты (short/full)
- Расписание звонков (начало, длительность, перерывы)

---

### 2.7 appsscript.json
**Файл:** `apps_script/labs_form/appsscript.json`

Манифест Apps Script:
- Timezone: `Europe/Minsk`
- Runtime: V8
- OAuth Scopes: spreadsheets.currentonly, script.container.ui, script.external_request

---

## 3. Документация (`docs/`)

### `docs/BACKEND_HANDOFF.md`
688 строк. Техническое задание для backend-разработчика.

**Содержание:**
- Принципы архитектуры (backend — SSOT)
- Все API endpoints с примерами запросов/ответов
- Формат плана (`planned_pairs`)
- Спецификация SSE для realtime
- CORS настройки
- Acceptance checklist

### `docs/FRONTEND_GUIDE.md`
330 строк. Руководство для frontend-разработчика.

**Содержание:**
- Установка и запуск
- Команды npm
- Environment variables
- Источники данных (API форматы)
- Структура кода
- Где что менять

---

## 4. Конфигурация

### `vite.config.ts`
Vite конфиг: Svelte плагин, алиас `@/` → `./src/`, порт 5173.

### `tailwind.config.ts`
Tailwind CSS 3: darkMode 'class', контент `./src/**/*.{svelte,ts}`, кастомные цвета.

### `tsconfig.json`
TypeScript strict: `strict: true`, `noUnusedLocals: true`, пути `@/` → `./src/`.

### `eslint.config.js`
ESLint 9 flat config: TypeScript + Svelte плагины.

### `vercel.json`
SPA rewrite: `{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }`.

### `.env.example`
```bash
VITE_API_BASE_URL=https://rfict.up.railway.app
```
