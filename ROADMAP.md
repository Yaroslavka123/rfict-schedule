# rfict-schedule — Архитектура и Roadmap

## 0. Контекст

**Сейчас**: React 19 SPA, лаги, все 4 вьюхи в DOM, тултип на `mousemove`, нет DnD, parity в аналитике только как label.

**Цель**: Svelte 5, быстрый рендер, экономия ресурсов, полный экран для матриц, DnD колонок, рабочий parity.

### Untouched files (чистый TS — переносятся как есть)

```
src/types/schedule.ts          — 128 строк
src/lib/schedule.ts            — 581 строка (business logic)
src/lib/constants.ts           — 39 строк
src/lib/utils.ts               — 49 строк
src/api/scheduleClient.ts      — 284 строки
src/index.css                  — 349 строк (Tailwind + кастомные классы — переиспользуются)
```

### Файлы на переписку (TSX → Svelte)

```
src/main.tsx                   → src/main.ts + src/App.svelte
src/App.tsx                    → src/App.svelte
src/hooks/useSchedule.ts       → src/stores/scheduleStore.ts
src/hooks/useTheme.ts          → src/stores/themeStore.ts
src/hooks/useDebouncedValue.ts → встроенный $: дебаунс
src/components/layout/AppShell.tsx    → src/components/layout/AppShell.svelte
src/components/layout/GlobalFilters.tsx → src/components/layout/GlobalFilters.svelte
src/components/ui/*.tsx               → src/components/ui/*.svelte (4 файла)
src/features/schedule/ScheduleView.tsx  → src/features/schedule/ScheduleView.svelte
src/features/rooms/RoomsView.tsx       → src/features/rooms/RoomsView.svelte
src/features/teachers/TeachersView.tsx  → src/features/teachers/TeachersView.svelte
src/features/analytics/AnalyticsView.tsx → src/features/analytics/AnalyticsView.svelte
```

---

## Phase 0 — Svelte Scaffold

### Task 0.1 — Replace framework

- `npm create vite@latest . -- --template svelte-ts`
- `npm uninstall react react-dom clsx class-variance-authority tailwind-merge recharts @types/react @types/react-dom`
- `npm install lucide-svelte`
- Update `tsconfig.json` (paths: `@/` → `./src/`)
- Remove `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh`
- Add `svelte-check`, `eslint-plugin-svelte`

### Task 0.2 — Bootstrap stores

**`src/stores/scheduleStore.ts`** — замена `useSchedule.ts`:

- `writable<ScheduleState>` с теми же полями (schedule, plan, plans, loading, error, loadedAt)
- `fetch(course)` — вызывает `loadCourseBundle` / `loadAllCoursesBundle`
- `refresh()` — инкрементит `refreshKey`
- `updatePlan(entry)` — optimistic update + PUT + rollback
- In-memory cache (`Map<string, CachedBundle>`) — JSON.parse 1 раз за сессию
- Debounced localStorage write (300ms)

**`src/stores/themeStore.ts`** — замена `useTheme.ts`:

- `writable<'dark' | 'light'>`
- `toggleTheme()`
- `$effect` → `document.documentElement.classList.toggle('dark')`
- `$effect` → `localStorage.setItem`

**`src/stores/columnGroups.ts`** — новое:

- `writable<Record<string, ColumnGroup[]>>` — отдельно для rooms, teachers
- `ColumnGroup: { id, name, items: string[], collapsed, isBuiltIn }`
- `addGroup(name)`, `removeGroup(id)`, `renameGroup(id, name)`, `addItem(groupId, item)`, `removeItem(groupId, item)`, `reorder(fromIdx, toIdx)`, `toggleCollapse(id)`
- `$effect` → `localStorage.setItem('rfict-room-groups')`
- Built-in groups: для rooms — lecture-hall, computer, regular

### Task 0.3 — Bootstrap app shell

**`src/App.svelte`**:

- `{#if activeTab === 'rooms'} ... {:else if activeTab === 'teachers'} ... {:else if activeTab === 'analytics'} ... {:else if activeTab === 'schedule'} ...` — монтирует только активный таб
- Фильтры справа (sticky top)
- Grid layout для rooms: `flex gap-3 h-[calc(100vh-var(--header-h))]`, для остальных аналогично

**`src/components/layout/AppShell.svelte`**:

- Хедер: лого, табы, refresh button, theme toggle, "обновлено X мин назад"

**`src/components/layout/GlobalFilters.svelte`**:

- Course select
- Group select (фильтруется по курсу)
- Subgroup select (показывается если группа выбрана и не rooms)
- Week buttons (schedule + rooms)
- Lesson type chips (schedule + teachers + rooms)
- Search input (schedule + teachers + analytics)
- Reset button
- Derived store для visibleGroups, availableWeeks, subgroupOptions

### Task 0.4 — UI primitives

4 файла в `src/components/ui/`:

```
Button.svelte — <button class="btn-{variant}">, variants: primary, secondary, ghost
Card.svelte — <div class="rounded-lg border border-border bg-card">, слот header, slot content
Input.svelte — <input class="..." />, type=text/number, bind:value
Highlight.svelte — подсветка текста по поисковому запросу
```

---

## Phase 1 — Layout: Full-Screen Tables

### Bug: таблицы rooms/teachers не на весь экран

Текущий grid `lg:grid-cols-[minmax(0,1fr)_16rem]` + `tab-panel-hidden` оставляет 3 мёртвых вьюхи в DOM.

### Task 1.1 — Разделить layout по табам

**`App.svelte`**:

```svelte
{#if activeTab === 'rooms'}
  <div class="flex gap-3 h-[calc(100vh-var(--header-h))]">
    <div class="flex-1 min-w-0">
      <RoomsView />
    </div>
    <aside class="w-56 shrink-0 hidden lg:block">
      <GlobalFilters minimal={true} />
    </aside>
  </div>
{:else if activeTab === 'teachers'}
  <!-- аналогично -->
{/if}
```

Ключевые моменты:
- `h-[calc(100vh-var(--header-h))]` — таблица тянется до низа экрана
- Flex вместо Grid — проще контролировать растяжение
- `--header-h: 3rem` — высота хедера
- Фильтры **фиксированной ширины** (w-56 / w-64), не резиновые
- `hidden lg:block` — на мобилках фильтры в оверлее

### Task 1.2 — RoomsView: full-height matrix

**`.room-matrix-wrap`** в CSS уже есть `flex: 1 1 auto; min-height: 0; overflow: auto`. Проверить что родитель передаёт высоту (`h-full`).

### Task 1.3 — TeachersView: full-height matrix

Аналогично RoomsView — `flex: 1 1 auto + overflow: auto`.

---

## Phase 2 — Tooltip Fix

### Bug: тултип далеко от курсора

**Причина**: `onMouseMove` обновляет `setState` на каждом пикселе → React не успевает отрендерить новую позицию → тултип «отстаёт». Плюс React batching задерживает обновление.

### Task 2.1 — Убрать onMouseMove

**Было (React)**:
```tsx
onMouseEnter={(e) => showTooltip(e, entries)}
onMouseMove={(e) => showTooltip(e, entries)}
```

**Стало (Svelte)**:
```svelte
on:mouseenter={(e) => {
  tooltipPos = { x: e.clientX + 12, y: e.clientY + 12 }
  tooltipEntries = entries
  tooltipVisible = true
}}
on:mouseleave={() => { tooltipVisible = false }}
```

- Позиция фиксируется при входе в ячейку
- Без `mousemove` — без лага
- `+12` вместо `+8` для небольшого отступа

### Task 2.2 — Tooltip как портал

```svelte
{#if tooltipVisible}
  <div class="slot-tooltip fixed z-50 pointer-events-none"
       style="left: {tooltipPos.x}px; top: {tooltipPos.y}px">
    ...
  </div>
{/if}
```

Убедиться что тултип находится **вне** scroll-контейнера (можно в `body` через портал или просто на уровне App).

---

## Phase 3 — Drag & Drop Column Groups

### Task 3.1 — Column groups store (см. Task 0.2)

### Task 3.2 — DnD action для rooms

**Логика**:
1. `<th>` колонки — `draggable="true"`
2. `on:dragstart` — запомнить room name в `dataTransfer`
3. `on:dragover` — показать индикатор (vertical line)
4. `on:drop` — `columnGroupsStore.reorder(from, to)`

**Visual**:
- При перетаскивании — полупрозрачная копия колонки
- Индикатор — синяя линия между колонками
- При наведении на заголовок группы — подсветка группы

### Task 3.3 — Column group header

**Группа отображается как**:
```
[Поточные ▼]  [115] [117] [119] | [Комп. классы ▼] [К1] [К2] ...
```

- Заголовок группы — `<th>` с `colspan` = количеству колонок
- Клик по заголовку — collapse/expand (все колонки группы скрываются/показываются)
- Drag колонки на заголовок группы — добавление в группу
- Кнопка «+» над таблицей → создание группы

### Task 3.4 — DnD + groups для teachers

**То же самое, что 3.2–3.3, но для колонок преподавателей**.

Отличия:
- Вместо комнат — имена преподавателей
- Built-in groups: отсутствуют (все преподы в одной группе по умолчанию)
- Vertical labels на заголовках (`writing-mode: vertical-rl`) — как сейчас

### Task 3.5 — Persistence

- `$effect` → `localStorage.setItem`
- При инициализации: `localStorage.getItem('rfict-room-groups') || defaults`
- Default groups для rooms:
  ```json
  [
    { "id": "lectures", "name": "Поточные", "items": ["115","117","119"], "collapsed": false, "isBuiltIn": true },
    { "id": "computers", "name": "Комп. классы", "items": ["К1","К2","К3"], "collapsed": false, "isBuiltIn": true },
    { "id": "regular", "name": "Кабинеты", "items": ["101","102","103","104","105","106"], "collapsed": false, "isBuiltIn": true }
  ]
  ```
- Default для teachers: пустой массив

---

## Phase 4 — Analytics: Parity Logic

### Bug: parity (чёт/нечёт) определён, но не влияет на подсчёт

В `schedule.ts`:
```
line 358: parity: detectParity(weekNumbers)  // только label
line 519: scheduled = sum(pairsFor(lesson))   // считаются ВСЕ занятия
line 520: done = sum(pairsFor(lesson if before today))  // считаются ВСЕ прошедшие
```

**Проблема**: если подгруппа ходит только по чётным неделям, но в расписании есть записи на все 18 недель, `scheduled` покажет 18, хотя по факту должно быть 9 (только чётные).

### Task 4.1 — Новая функция: `parityFilter(lesson, parity)`

```typescript
function parityFilter(lesson: ScheduleLesson, parity: SubgroupParity): boolean {
  if (parity === 'none' || parity === 'mixed') return true
  if (lesson.week_number === undefined) return true
  const isEven = lesson.week_number % 2 === 0
  return parity === 'even' ? isEven : !isEven
}
```

### Task 4.2 — Изменить `buildSubjectPlanRows`

Перед `pairsFor` добавить фильтр по parity:

```typescript
const subgroupLessons = groupLessons.filter(lesson =>
  matchesSubgroup(lesson.subgroup, subgroupName)
)
// определяем parity ДО подсчёта
const weekNumbers = subgroupLessons
  .map(l => l.week_number)
  .filter((v): v is number => Number.isFinite(v as number))
const parity = subgroupName ? detectParity(weekNumbers) : 'none'

// теперь считаем с учётом parity
const parityCorrected = subgroupLessons.filter(l => parityFilter(l, parity))
const scheduled = parityCorrected.reduce((sum, l) => sum + pairsFor(l), 0)
const done = parityCorrected.reduce((sum, l) =>
  sum + (isLessonBeforeToday(l, today) ? pairsFor(l) : 0), 0
)
```

**Важно**: parity определяется **от всех занятий подгруппы**, а фильтр применяется **к их подсчёту**. Это корректно, если parity детектируется как 'odd' — считаются только нечётные недели.

### Task 4.3 — Изменить `buildPlanFactHierarchy`

Та же логика в `buildPlanFactHierarchy` (строка 518-531):

```typescript
// до:
const weekNumbers = sl.map(l => l.week_number)...
const parity = detectParity(weekNumbers)
// scheduled = sum(pairsFor)

// после:
const parity = detectParity(weekNumbers)
const parityFiltered = sl.filter(l => parityFilter(l, parity))
const scheduled = parityFiltered.reduce(...)
const done = parityFiltered.reduce(...)
```

### Task 4.4 — Убрать `parity` как UI-бейдж

**Не показывать "чёт/нечёт/каждую" в UI**. Parity должна влиять на цифры, а не показываться как отдельная метка.

Пользователь хочет видеть:
```
Предмет         План  В расписании  Проведено  Осталось
Математика      36    18            10         26
```
Где 18 — это реальное количество с учётом parity (недель, когда занятия реально были), а не все 36 записей из расписания.

### Task 4.5 — Подгруппы как числа

Подгруппы показывать как "1", "2", "3", "4" (если subgroup = "1 подгруппа" → "1", если subgroup = "1" → "1"). В CSV экспорте тоже.

---

## Phase 5 — Search Highlighting

### Task 5.1 — Highlight component

```svelte
<!-- components/ui/Highlight.svelte -->
<script>
  let { text = '', query = '' } = $props()
</script>

{#if !query}
  {text}
{:else}
  {@const parts = text.split(new RegExp(`(${escapeRegex(query)})`, 'gi'))}
  {#each parts as part}
    {#if part.toLowerCase() === query.toLowerCase()}
      <mark class="bg-yellow-200 dark:bg-yellow-800 rounded px-0.5">{part}</mark>
    {:else}
      {part}
    {/if}
  {/each}
{/if}
```

### Task 5.2 — Apply to ScheduleView

В строках таблицы расписания:
```svelte
<td><Highlight text={lesson.subject} query={search} /></td>
<td><Highlight text={lesson.teacher} query={search} /></td>
<td><Highlight text={lesson.room} query={search} /></td>
```

### Task 5.3 — Apply to TeachersView

При поиске преподавателя:
- Заголовок колонки (имя препода) — выделить
- Ячейки с его занятиями — подсветить границу

### Task 5.4 — Apply to RoomsView

При поиске (если добавить поиск в rooms):
- Заголовок комнаты — выделить
- Ячейки — подсветить

---

## Phase 6 — Performance (must have)

### Task 6.1 — In-memory cache для JSON.parse

В `scheduleStore.ts`:
```typescript
const memoryCache = new Map<string, CachedBundle>()
// readCache: check memoryCache first → if miss, localStorage → JSON.parse → memoryCache.set
// writeCache: memoryCache.set + debounced localStorage.set
```

### Task 6.2 — Debounced localStorage write

```typescript
function debouncedWrite(key: string, data: unknown, delay = 500) {
  const id = setTimeout(() => {
    try { localStorage.setItem(key, JSON.stringify(data)) } catch {}
  }, delay)
  return () => clearTimeout(id)
}
```

### Task 6.3 — Derived stores для матриц

В Svelte:
```typescript
let occupancy = $derived(buildOccupancy($schedule, $selectedWeek, $groups))
```
`$derived` автоматически кэшируется — пересчёт только при изменении зависимостей.

### Task 6.4 — CSS only: анимация тултипа

```css
.slot-tooltip {
  animation: fadeIn 0.1s ease-out;
}
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(-2px); }
  to { opacity: 1; transform: translateY(0); }
}
```

---

## Execution Order

| Day | Phase | Deliverable |
|---|---|---|
| 1 | 0 | Svelte scaffold, stores, AppShell, GlobalFilters, UI primitives |
| 2 | 1 | Full-screen layout для rooms + teachers, проверить переключение табов |
| 2 | 2 | Tooltip fix (mouseenter only, portal, animation) |
| 3 | 3 | DnD column groups для rooms + teachers |
| 4 | 3 | Column groups UI (collapse, create, rename, persist) |
| 4 | 4 | Analytics parity fix (`parityFilter`, `buildSubjectPlanRows`, `buildPlanFactHierarchy`) |
| 5 | 5 | Search highlighting (Highlight component, ScheduleView, TeachersView) |
| 5 | 6 | Performance (in-memory cache, debounced write, derived stores) |

---

## Правила для AI-исполнителя

1. **Никогда не трогать** `src/types/`, `src/lib/`, `src/api/`, `src/index.css`
2. **Svelte 5 runes**: используй `$state()`, `$derived()`, `$effect()`, `$props()`
3. **`class:`** для условных классов, классы из `index.css` для кастомных стилей
4. **`{#if}`** вместо `display: none` — монтируй только активный таб
5. **`on:mouseenter`** вместо `on:mousemove` в таблицах
6. **Store = writable** → derived для трансформаций
7. **push, не pull** — данные фетчатся один раз, store обновляется через refresh/plan update
8. **Verification**: `npm run build`, `npm run lint`, переключить все табы, проверить тултип, DnD, поиск, parity-цифры
