# Performance Roadmap

Дата создания: 2026-06-07.
Источник данных: Chrome DevTools trace (81с, 196MB), `performance_tests/data_export_For_2.json`, `performance_tests/Trace2.json`.

**Принцип:** сайт должен оставаться функционально идентичным. Все изменения — только в производительности. API-запросы, логика фильтрации, UI поведение не меняются.

---

## Краткая сводка проблем из trace

| Метрика | Значение | Budget |
|---|---|---|
| AnimationFrame max | 1256ms | <16.6ms |
| AnimationFrame avg | 14.1ms | <16.6ms |
| MouseMove avg latency | 61.8ms | <4ms |
| Paint events total | 30,933 | <5,000 |
| Paint max | 70.5ms | <4ms |
| Long tasks (>100ms) | 37 | 0 |
| Long task max | 1417ms | <50ms |
| HandlePostMessage avg | 187ms | <10ms |
| RunTask total | 190,013 | — |
| MajorGC count | 7 | 0 |
| MajorGC avg | 25.8ms | <5ms |
| UpdateLayoutTree | 3,254 | <500 |
| Layout (forced) | 548, avg 4.6ms | <1ms |

---

## Phase 0: CSS Hot Path (1–2 дня)

**Цель:** убрать transition/animation с элементов матрицы, которые рендерятся тысячами.

**Impact:** -60% Paint, -40% AnimationFrame, -30% MouseMove latency.

### 0.1 Убрать transition с .slot-busy

**Файл:** `src/index.css` (строки 983–991)

```css
/* БЫЛО */
.slot-busy {
  @apply cursor-help overflow-hidden text-[10px] leading-tight;
  transition:
    background-color 160ms var(--ease),
    box-shadow 180ms var(--ease);
}
.slot-busy:hover {
  @apply ring-2 ring-inset ring-primary/60 z-10;
}

/* СТАЛО */
.slot-busy {
  @apply cursor-help overflow-hidden text-[10px] leading-tight;
}
.slot-busy:hover {
  outline: 2px solid hsl(var(--primary) / 0.6);
  outline-offset: -2px;
}
```

**Почему:** `ring` = `box-shadow`, который триггерит repaint. `outline` не влияет на layout и не создаёт repaint area. Убираем `z-index` на hover — tooltip и так через `position: fixed`.

### 0.2 Убрать transition с .dense-table tbody tr td

**Файл:** `src/index.css` (строки 488–490)

```css
/* БЫЛО */
.dense-table tbody tr td {
  transition: color 200ms var(--ease);
}

/* СТАЛО */
.dense-table tbody tr td {
  /* без transition — color меняется мгновенно, это не заметно */
}
```

### 0.3 Убрать transition с .slot-free:hover

**Файл:** `src/index.css` (строки 978–981)

```css
/* БЫЛО */
.slot-free:hover { background-color: hsl(var(--muted) / 0.4); }

/* СТАЛО — оставить без transition, background-color на transparent → muted не заметен */
.slot-free:hover { background-color: hsl(var(--muted) / 0.4); }
```

### 0.4 Убрать will-change с .matrix-drag-preview

**Файл:** `src/index.css` (строка 754)

```css
/* БЫЛО */
.matrix-drag-preview {
  ...
  will-change: transform;
}

/* СТАЛО */
.matrix-drag-preview {
  ...
  /* will-change не нужен — transform уже GPU-composited через translate3d */
}
```

### 0.5 Убрать transition с body (оставить только для theme toggle)

**Файл:** `src/index.css` (строка 61)

```css
/* БЫЛО */
body {
  transition: background-color 220ms var(--ease), color 220ms var(--ease);
}

/* СТАЛО — оставить, это редкая операция (theme toggle) */
body {
  transition: background-color 220ms var(--ease), color 220ms var(--ease);
}
```

Оставляем как есть — theme toggle редкий, transition не проблема.

### 0.6 Убрать transition с .app-header

**Файл:** `src/index.css` (строка 142)

```css
/* БЫЛО */
.app-header {
  transition: box-shadow 240ms var(--ease), background-color 220ms var(--ease);
}

/* СТАЛО */
.app-header {
  /* box-shadow меняется при scroll — это 1 элемент, transition OK */
}
```

Оставляем — это 1 элемент, не影響.

### 0.7 Убрать pseudo-element ::before для group border

**Файл:** `src/index.css` (строки 811–831)

```css
/* БЫЛО */
.matrix-drag-over-before::before,
.matrix-drag-over-after::before {
  content: '';
  position: absolute;
  ...
  animation: drag-marker-in 130ms var(--ease) both;
}

/* СТАЛО — оставить, это только при active drag (1 элемент) */
```

Оставляем — pseudo-element только на 1 элементе при drag.

### 0.8 Убрать transition с .matrix-draggable-header

**Файл:** `src/index.css` (строки 786–795)

```css
/* БЫЛО */
.matrix-draggable-header {
  transition:
    background-color 120ms var(--ease),
    color 120ms var(--ease),
    opacity 120ms var(--ease),
    box-shadow 140ms var(--ease),
    outline-color 140ms var(--ease);
}

/* СТАЛО — оставить только opacity и box-shadow, убрать background-color/color */
.matrix-draggable-header {
  transition:
    opacity 120ms var(--ease),
    box-shadow 140ms var(--ease),
    outline-color 140ms var(--ease);
}
```

### 0.9 Добавить content-visibility: auto на строки матрицы

**Файл:** `src/index.css`

```css
/* ДОБАВИТЬ */
.room-matrix tbody tr,
.teachers-matrix tbody tr {
  content-visibility: auto;
  contain-intrinsic-size: 0 2rem;
}
```

**Почему:** строки за пределами viewport не рендерятся браузером. Matrix 6 дней × 8 пар = 48 строк, но при большом числе columns DOM огромный. `content-visibility: auto` позволяет браузеру skip layout/paint для невидимых строк.

### 0.10 Убрать backdrop-filter с .slot-tooltip

**Файл:** `src/index.css` (строка 1060)

```css
/* БЫЛО */
.slot-tooltip {
  backdrop-filter: none;
}

/* СТАЛО — уже none, оставить как есть */
```

---

## Phase 1: MouseMove Throttling (0.5 дня)

**Цель:** ограничить частоту обработки hover на матрице.

**Impact:** -50% MouseMove latency, -20% RunTask count.

### 1.1 RAF gate для handleTableHover

**Файл:** `src/features/matrix/MatrixView.svelte`

```typescript
// БЫЛО (строка 356)
function handleTableHover(event: MouseEvent) {
  if (draggedColumn) {
    hideTooltip()
    return
  }
  const cell = (event.target as HTMLElement).closest('td[data-slot-key]') as HTMLTableCellElement | null
  // ... полная обработка
}

// СТАЛО
let hoverFrame: number | null = null
let pendingHoverEvent: MouseEvent | null = null

function handleTableHover(event: MouseEvent) {
  if (draggedColumn) {
    hideTooltip()
    return
  }
  pendingHoverEvent = event
  if (hoverFrame !== null) return
  hoverFrame = requestAnimationFrame(flushHover)
}

function flushHover() {
  hoverFrame = null
  const event = pendingHoverEvent
  pendingHoverEvent = null
  if (!event) return
  // существующая логика обработки
  const cell = (event.target as HTMLElement).closest('td[data-slot-key]') as HTMLTableCellElement | null
  if (!cell || !(event.currentTarget as HTMLElement).contains(cell)) {
    hideTooltip()
    return
  }
  const key = cell.dataset.slotKey
  if (!key) {
    hideTooltip()
    return
  }
  if (key === tooltipKey && tooltip) {
    queueTooltip(event, tooltip.entries, tooltip.column, key)
    return
  }
  const column = cell.dataset.matrixColumn
  const day = cell.dataset.slotDay
  const pair = Number(cell.dataset.slotPair)
  const visibleCell = column && day && Number.isFinite(pair) ? getVisibleCell(column, day, pair) : null
  const entries = visibleCell ? adapter.getCellEntries(visibleCell) : []
  if (entries.length && column) queueTooltip(event, entries, column, key)
  else hideTooltip()
}

onDestroy(() => {
  // добавить cleanup
  if (hoverFrame !== null) cancelAnimationFrame(hoverFrame)
})
```

### 1.2 RAF gate для flushPointerDrag

**Файл:** `src/features/matrix/MatrixView.svelte`

Это уже сделано (строки 456–470). `pendingDragPoint` + `dragFrame` + `requestAnimationFrame`. Оставляем как есть.

---

## Phase 2: Worker Message Optimization (1–2 дня)

**Цель:** уменьшить размер сообщений worker ↔ main thread.

**Impact:** -70% HandlePostMessage latency, -40% GC pressure.

### 2.1 Не передавать source при каждом search

**Файл:** `src/features/matrix/MatrixView.svelte`

Это уже частично сделано (строки 154–157): `searchWorkerSource !== currentSource`. Но `source` передаётся при каждой смене недели. Проблема в том, что `source` — это `RoomOccupancyIndex` / `TeacherOccupancyIndex`, который содержит `occupancy` — вложенный объект с ячейками.

**Решение:** передавать только `orderedRooms` / `orderedTeachers` + `occupancy` как Map, а не как вложенный object. Или: worker уже хранит source, передавать source только при смене недели (это уже сделано).

**Фактически:** проблема не в source clone, а в том, что `buildCellMap` (строка 217) пересоздаёт Map при каждом search. Worker возвращает `cells` (массив пар), и `adapter.buildCellMap` строит новый Map.

**Решение:**.worker должен возвращать `Set<string>` (только ключи matched cells), а не полный `cells` массив. Тогда `buildCellMap` не нужен — `getVisibleCell` проверяет `cellByKey.has(key)`.

```typescript
// Новый тип для worker response
type MatrixSearchWorkerMessage = {
  type: 'rooms-result' | 'teachers-result'
  id: number
  matchedKeys: string[] | null  // вместо cells
  matches: ReadonlySet<string> | null
}

// В MatrixView.svelte
function applyFilterResult(currentSource, result) {
  if (!currentSource || !result.matchedKeys) {
    cellByKey = null
  } else {
    cellByKey = new Set(result.matchedKeys)  // Set<string> вместо Map
  }
  columnMatch = result.matches
}

function getVisibleCell(column, day, pair) {
  if (!source) return null
  if (!cellByKey) return adapter.getCell(source, column, day, pair)
  const key = adapter.slotKey(column, day, pair)
  if (!cellByKey.has(key)) return null  // filtered out
  return adapter.getCell(source, column, day, pair)  // возвращаем полную ячейку
}
```

**Но:** это меняет поведение — сейчас при filter возвращаются ячейки с подмножеством entries. При новом подходе возвращаются полные ячейки. Это OK если filter только показывает/скрывает ячейки, а не модифицирует их содержимое.

**Проверка:** `buildRoomCellMap` (строки 12–31) — при `entryIndexes === null` возвращает оригинальную ячейку. При `entryIndexes !== null` создаёт подмножество. Значит, filter确实 модифицирует ячейки.

**Альтернатива:** передавать отфильтрованный `occupancy` (только matching cells) вместо полного source. Тогда worker clone меньше.

**Компромисс:** оставить текущий подход, но оптимизировать `buildCellMap` — не пересоздавать Map, а обновлять in-place.

### 2.2 Transferable ArrayBuffer для worker messages

**Файл:** `src/features/matrix/matrixWorkerClient.ts`

```typescript
// БЫЛО
self.onmessage = (event) => {
  // ...
  post({ type: 'rooms-result', id: message.id, ...filterRoomMatrix(...) })
}

// СТАЛО — использовать Transferable для large arrays
function post(response: WorkerResponse) {
  if (response.cells && response.cells.length > 100) {
    // Конвертируем cells в compact format
    const keys = new Array(response.cells.length)
    const indexes = new Array(response.cells.length)
    response.cells.forEach(([key, idx], i) => {
      keys[i] = key
      indexes[i] = idx
    })
    self.postMessage({ ...response, cells: undefined, keys, indexes })
  } else {
    self.postMessage(response)
  }
}
```

**Примечание:** это оптимизация, но не критичная. Основной win — от Phase 0 (CSS).

### 2.3 Кэшировать searchResultCache дольше

**Файл:** `src/features/matrix/MatrixView.svelte`

```typescript
// БЫЛО (строка 55)
const SEARCH_CACHE_TTL_MS = 5000

// СТАЛО
const SEARCH_CACHE_TTL_MS = 30_000  // 30 секунд — search query не меняется часто
```

---

## Phase 3: Analytics Memoization (1–2 дня)

**Цель:** не пересчитывать `buildPlanFactHierarchy` при каждом keystroke.

**Impact:** -80% analytics layout time, -50% analytics script execution.

### 3.1 Мемоизировать buildPlanFactHierarchy

**Файл:** `src/features/analytics/analyticsIndex.ts`

```typescript
// Добавить кэш
const hierarchyCache = new WeakMap<AnalyticsIndex, {
  plans: Record<number, CoursePlanMap>
  todayStamp: number
  search: string
  result: PlanFactCourse[]
}>()

export function buildPlanFactHierarchy(options: BuildIndexedPlanFactOptions): PlanFactCourse[] {
  const { index, plans, today = new Date(), search } = options
  const query = search ? normalizeSearchQuery(search) : ''
  const todayStamp = dateDayStamp(today)

  const cached = hierarchyCache.get(index)
  if (
    cached &&
    cached.plans === plans &&
    cached.todayStamp === todayStamp &&
    cached.search === query
  ) {
    return cached.result
  }

  const result = buildPlanFactHierarchyUncached(options)
  hierarchyCache.set(index, { plans, todayStamp, search: query, result })
  return result
}

function buildPlanFactHierarchyUncached(options: BuildIndexedPlanFactOptions): PlanFactCourse[] {
  // существующая логика
}
```

### 3.2 Debounce search в AnalyticsView

**Файл:** `src/features/analytics/AnalyticsView.svelte`

```typescript
// БЫЛО (строка 100)
let courseRows = $derived(
  active && analyticsIndex
    ? buildPlanFactHierarchy({ index: analyticsIndex, plans, today, search })
    : [],
)

// СТАЛО — добавить debounce для search
let debouncedSearch = $state('')
$effect(() => {
  const q = search
  const timeout = setTimeout(() => {
    debouncedSearch = q
  }, 200)
  return () => clearTimeout(timeout)
})

let courseRows = $derived(
  active && analyticsIndex
    ? buildPlanFactHierarchy({ index: analyticsIndex, plans, today, search: debouncedSearch })
    : [],
)
```

### 3.3 Optimistic setInput

**Файл:** `src/features/analytics/AnalyticsView.svelte`

```typescript
// БЫЛО (строка 240)
function setInput(key: string, value: string) {
  planInputs = { ...planInputs, [key]: value }
  // ...
}

// СТАЛО — mutate + reassign для trigger reactivity
function setInput(key: string, value: string) {
  planInputs[key] = value
  planInputs = planInputs  // trigger Svelte reactivity
  if (saveStatus[key] === 'saved') {
    delete saveStatus[key]
    saveStatus = saveStatus
    // ...
  }
}
```

### 3.4 Optimistic savingRows / saveStatus

**Файл:** `src/features/analytics/AnalyticsView.svelte`

```typescript
// БЫЛО (строка 278)
savingRows = { ...savingRows, [key]: true }

// СТАЛО
savingRows[key] = true
savingRows = savingRows
```

### 3.5 Не обновлять today каждую минуту

**Файл:** `src/features/analytics/AnalyticsView.svelte`

```typescript
// БЫЛО (строка 66)
$effect(() => {
  if (!active) return
  const interval = setInterval(() => {
    const nextStamp = dayStamp(new Date())
    if (nextStamp !== currentDayStamp) currentDayStamp = nextStamp
  }, 60_000)
  return () => clearInterval(interval)
})

// СТАЛО — обновлять каждые 10 минут, этого достаточно
$effect(() => {
  if (!active) return
  const interval = setInterval(() => {
    const nextStamp = dayStamp(new Date())
    if (nextStamp !== currentDayStamp) currentDayStamp = nextStamp
  }, 600_000)  // 10 минут
  return () => clearInterval(interval)
})
```

---

## Phase 4: matrixFilter Optimization (1 день)

**Цель:** ускорить triple-nested Object.entries loop в filterRoomMatrix / filterTeacherMatrix.

**Impact:** -40% search execution time.

### 4.1 Предвычислить searchKey для rooms

**Файл:** `src/features/matrix/matrixFilter.ts`

```typescript
// БЫЛО (строка 44)
function getRoomSearchKey(room: string) {
  const cached = roomSearchKeyCache.get(room)
  if (cached !== undefined) return cached
  const key = buildSearchKey(room)
  roomSearchKeyCache.set(room, key)
  return key
}

// СТАЛО — roomSearchKeyCache уже есть, оставить
```

Оставляем как есть — кэш уже работает.

### 4.2 Оптимизировать entryIndexes accumulation

**Файл:** `src/features/matrix/matrixFilter.ts` (строки 72–81)

```typescript
// БЫЛО
cell.entries.forEach((entry, index) => {
  if (roomEntryMatches(entry, activeGroup, query, types)) {
    matchedCount += 1
    entryIndexes?.push(index)
  } else if (entryIndexes === null) {
    entryIndexes = Array.from({ length: matchedCount }, (_, matchedIndex) => matchedIndex)
  }
})

// СТАЛО — проще и без промежуточных аллокаций
let firstNonMatch = -1
let matchCount = 0
for (let i = 0; i < cell.entries.length; i++) {
  if (roomEntryMatches(cell.entries[i], activeGroup, query, types)) {
    matchCount++
  } else if (firstNonMatch === -1) {
    firstNonMatch = i
  }
}
if (matchCount === 0) return
hasMatchingCell = true

let entryIndexes: number[] | null = null
if (matchCount < cell.entries.length) {
  entryIndexes = []
  for (let i = 0; i < cell.entries.length; i++) {
    if (roomEntryMatches(cell.entries[i], activeGroup, query, types)) {
      entryIndexes.push(i)
    }
  }
}
cells.push([roomSlotKey(room, day, Number(pair)), entryIndexes])
```

### 4.3 Избежать Object.entries в hot path

**Файл:** `src/features/matrix/matrixFilter.ts`

```typescript
// БЫЛО
Object.entries(days).forEach(([day, pairs]) => {
  Object.entries(pairs).forEach(([pair, cell]) => {
    // ...
  })
})

// СТАЛО — использовать Object.keys + прямой доступ
const dayKeys = Object.keys(days)
for (let di = 0; di < dayKeys.length; di++) {
  const day = dayKeys[di]
  const pairs = days[day]
  const pairKeys = Object.keys(pairs)
  for (let pi = 0; pi < pairKeys.length; pi++) {
    const pair = pairKeys[pi]
    const cell = pairs[pair]
    // ...
  }
}
```

---

## Phase 5: ScheduleStore Index Optimization (2–3 дня)

**Цель:** уменьшить время построения индекса и размер clone при передаче в worker.

**Impact:** -50% startup time, -30% GC pressure.

### 5.1 Lazy week-based index building

**Файл:** `src/stores/scheduleStore.ts`

```typescript
// БЫЛО (строки 599–620) — строим occupancy для ВСЕХ недель
Object.keys(weeksByNumber).forEach((week) => {
  const weekNumber = Number(week)
  // ... строим roomOccupancyByWeek[weekNumber]
})

// СТАЛО — строить occupancy только для текущей недели
// Остальные недели строить по demand (лениво)
const roomOccupancyByWeek: Record<number, RoomOccupancyIndex> = {}
const pendingRoomWeeks = new Set<number>()

// При第一次 обращении к roomOccupancyByWeek[week]:
function getRoomOccupancyForWeek(weekNumber: number): RoomOccupancyIndex {
  if (roomOccupancyByWeek[weekNumber]) return roomOccupancyByWeek[weekNumber]
  if (pendingRoomWeeks.has(weekNumber)) return emptyRoomIndex

  // Строим occupancy для этой недели
  const index = buildRoomOccupancyForWeek(weekNumber)
  roomOccupancyByWeek[weekNumber] = index
  return index
}
```

**Примечание:** это требует рефакторинга store. Более безопасный подход — оставить eager building, но оптимизировать clone.

### 5.2 Оптимизировать clone в scheduleIndexWorker

**Файл:** `src/stores/scheduleIndexWorker.ts`

```typescript
// БЫЛО
self.onmessage = (event) => {
  const { id, schedule } = event.data
  const index = buildScheduleIndex(schedule)
  self.postMessage({ id, index })
}

// СТАЛО — использовать Transferable для TypedArray
self.onmessage = (event) => {
  const { id, schedule } = event.data
  const index = buildScheduleIndex(schedule)
  // Конвертируем Record<number, ...> в compact form
  self.postMessage({ id, index })
}
```

**Примечание:** `scheduleIndexWorker` уже передаёт весь index. Основной clone — это `roomOccupancyByWeek` и `teacherOccupancyByWeek`. Если occupancy строить лениво, clone будет меньше.

### 5.3 Кэшировать roomCell/teacherCell результаты

**Файл:** `src/stores/scheduleStore.ts`

```typescript
// roomCell и teacherCell вызываются для КАЖДОЙ ячейки при построении индекса.
// Кэшировать по entries fingerprint.

const roomCellCache = new WeakMap<RoomSlotEntry[], RoomCell>()

export function roomCell(entries: RoomSlotEntry[], key: string): RoomCell {
  const cached = roomCellCache.get(entries)
  if (cached) return cached
  // ... существующая логика
  roomCellCache.set(entries, result)
  return result
}
```

**Примечание:** `entries` — это новый массив для каждой ячейки, поэтому WeakMap по ссылке не сработает. Нужно кэшировать по content hash.

---

## Phase 6: DOM Optimization (1–2 дня)

**Цель:** уменьшить размер DOM и количество layout/paint.

**Impact:** -30% Paint count, -20% Layout time.

### 6.1 content-visibility на строки

Уже описано в Phase 0.9.

### 6.2 Убрать sticky с .td-day и .td-pair

**Файл:** `src/index.css` (строки 899–912)

```css
/* БЫЛО */
.room-matrix .td-day,
.teachers-matrix .td-day {
  @apply sticky left-0 z-20 bg-card ...;
}
.room-matrix .td-pair,
.teachers-matrix .td-pair {
  @apply sticky z-20 bg-card ...;
  left: 2rem;
}

/* СТАЛО — оставить sticky, но убрать z-index */
.room-matrix .td-day,
.teachers-matrix .td-day {
  @apply sticky left-0 bg-card ...;
  z-index: 1;  /* вместо z-20 */
}
.room-matrix .td-pair,
.teachers-matrix .td-pair {
  @apply sticky bg-card ...;
  left: 2rem;
  z-index: 1;  /* вместо z-20 */
}
```

**Почему:** `z-index: 20` создаёт отдельный stacking context для каждой sticky ячейки. `z-index: 1` достаточен для sticky behavior.

### 6.3 Убрать box-shadow с .slot-badge

**Файл:** `src/index.css` (строка 1024)

```css
/* БЫЛО */
.slot-badge {
  @apply ... shadow-md;
}

/* СТАЛО */
.slot-badge {
  @apply ...;  /* без shadow */
}
```

**Почему:** badge — крошечный элемент (14×14px), shadow не заметен, но создаёт repaint.

---

## Phase 7: GC Pressure Reduction (1 день)

**Цель:** уменьшить количество MajorGC и их длительность.

**Impact:** -50% GC time, -20% frame drops.

### 7.1 Увеличить searchResultCache TTL

Уже описано в Phase 2.3.

### 7.2 Переиспользовать cellByKeyInternal Map

**Файл:** `src/features/matrix/MatrixView.svelte`

```typescript
// БЫЛО (строка 90)
const cellByKeyInternal = new Map<string, MatrixRenderCell>()

// СТАЛО — уже есть, оставить как есть (in-place update через .clear() + .set())
```

Оставляем — Map уже переиспользуется.

### 7.3 Batch state updates в MatrixView

**Файл:** `src/features/matrix/MatrixView.svelte`

```typescript
// БЫЛО (строки 209–222)
function applyFilterResult(currentSource, result, cacheKey) {
  const filterResult = { cells: result.cells, matches: result.matches }
  if (cacheKey) cacheSearchResult(cacheKey, filterResult)

  if (!currentSource || !filterResult.cells) {
    cellByKeyInternal.clear()
    cellByKey = null
  } else {
    adapter.buildCellMap(currentSource, filterResult.cells, cellByKeyInternal)
    cellByKey = cellByKeyInternal
  }
  columnMatch = filterResult.matches
}

// СТАЛО — batch updates через microtask
let pendingColumnMatch: ReadonlySet<string> | null = null

function applyFilterResult(currentSource, result, cacheKey) {
  const filterResult = { cells: result.cells, matches: result.matches }
  if (cacheKey) cacheSearchResult(cacheKey, filterResult)

  if (!currentSource || !filterResult.cells) {
    cellByKeyInternal.clear()
    cellByKey = null
  } else {
    adapter.buildCellMap(currentSource, filterResult.cells, cellByKeyInternal)
    cellByKey = cellByKeyInternal
  }
  pendingColumnMatch = filterResult.matches
  scheduleColumnMatchFlush()
}

function scheduleColumnMatchFlush() {
  queueMicrotask(() => {
    columnMatch = pendingColumnMatch
    pendingColumnMatch = null
  })
}
```

**Примечание:** это micro-optimization. Основной win — от Phase 0.

---

## Phase 8: ScheduleView Optimization (0.5 дня)

**Цель:** уменьшить DOM в ScheduleView при большом количестве уроков.

**Impact:** -20% ScheduleView render time.

### 8.1 Виртуализация строк ScheduleView

**Файл:** `src/features/schedule/ScheduleView.svelte`

**Примечание:** ScheduleView рендерит таблицу из filteredWeekLessons. При большом количестве уроков (все курсы) это может быть 500+ строк.

**Решение:** добавить `content-visibility: auto` на tbody tr.

```css
/* Добавить в index.css */
.dense-table tbody tr {
  content-visibility: auto;
  contain-intrinsic-size: 0 2.5rem;
}
```

---

## Приоритеты и порядок выполнения

| Phase | Impact | Effort | Risk | Dependencies |
|---|---|---|---|---|
| 0 | 🔴 Критический | 🟢 Низкий | 🟢 Нет | — |
| 1 | 🔴 Высокий | 🟢 Низкий | 🟢 Нет | — |
| 3 | 🟡 Средний | 🟢 Низкий | 🟢 Нет | — |
| 4 | 🟡 Средний | 🟢 Низкий | 🟢 Нет | — |
| 2 | 🟡 Средний | 🟡 Средний | 🟡 Средний | — |
| 6 | 🟡 Средний | 🟢 Низкий | 🟢 Нет | Phase 0 |
| 7 | 🟢 Низкий | 🟢 Низкий | 🟢 Нет | Phase 2 |
| 5 | 🟡 Средний | 🔴 Высокий | 🔴 Высокий | — |
| 8 | 🟢 Низкий | 🟢 Низкий | 🟢 Нет | Phase 0 |

**Рекомендуемый порядок:** 0 → 1 → 3 → 4 → 6 → 2 → 7 → 8 → 5

---

## Ожидаемый результат

| Метрика | До | После Phase 0–4 | После всех Phase |
|---|---|---|---|
| AnimationFrame max | 1256ms | <200ms | <100ms |
| AnimationFrame avg | 14.1ms | <8ms | <5ms |
| MouseMove avg | 61.8ms | <15ms | <8ms |
| Paint events | 30,933 | <10,000 | <5,000 |
| Paint max | 70.5ms | <20ms | <10ms |
| Long tasks >100ms | 37 | <5 | 0 |
| Long task max | 1417ms | <200ms | <50ms |
| HandlePostMessage avg | 187ms | <50ms | <20ms |
| MajorGC avg | 25.8ms | <10ms | <5ms |
| Layout avg | 4.6ms | <2ms | <1ms |

---

## Что НЕ меняется

- API endpoints и формат запросов/ответов
- Логика фильтрации (group, type, search)
- Google Sheets интеграция
- SSE подписка
- Кэширование в localStorage
- DnD поведение (column reorder, group assign)
- Tooltip content
- Analytics plan-fact hierarchy (логика, не производительность)
- ScheduleView отображение
- Theme toggle
- Auto-week selection
- Search suggestion
