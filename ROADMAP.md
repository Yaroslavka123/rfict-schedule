# Performance Roadmap

Дата создания: 2026-06-07.
Дата обновления: 2026-06-08.
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

## Phase 0: CSS Hot Path — ✅ ВЫПОЛНЕНО

### 0.1 Убрать transition с `.slot-busy` — ✅

**Файл:** `src/index.css:1109-1118`

- `transition` удалён
- `ring-2 ring-inset` → `outline: 2px solid` (не создаёт repaint area)

### 0.2 Убрать transition с `.dense-table td` — ✅

**Файл:** `src/index.css`

- Правило `.dense-table tbody tr td { transition: ... }` удалено

### 0.3 Убрать transition с `.slot-free:hover` — ✅

**Файл:** `src/index.css:1107`

- Нет transition

### 0.4 Убрать `will-change` с `.matrix-drag-preview` — ✅

**Файл:** `src/index.css:859-862`

- `will-change: transform` удалён

### 0.5 Оставить `body` transition — ✅

- Оставлено: `transition: background-color 220ms, color 220ms` (theme toggle — редкая операция)

### 0.6 Оставить `.app-header` transition — ✅

- Оставлено: `transition: box-shadow 240ms, background-color 220ms` (1 элемент)

### 0.7 Оставить pseudo-element для group border — ✅

- Оставлено: `::before` только при active drag (1 элемент)

### 0.8 Обрезать transition `.matrix-draggable-header` — ✅

**Файл:** `src/index.css:905-911`

- Оставлены только: `opacity`, `box-shadow`, `outline-color`
- Убраны: `background-color`, `color`

### 0.9 `content-visibility: auto` на строки матрицы — ❌ НЕ ВЫПОЛНЕНО

**Файл:** `src/index.css`

Добавить:

```css
.room-matrix tbody tr,
.teachers-matrix tbody tr {
  content-visibility: auto;
  contain-intrinsic-size: 0 2rem;
}
```

**Почему:** строки за пределами viewport не рендерятся браузером. DOM матрицы огромный при большом числе columns.

### 0.10 `backdrop-filter: none` на tooltip — ✅

**Файл:** `src/index.css:1191`

- Уже `none`

---

## Phase 1: MouseMove Throttling — ✅ ВЫПОЛНЕНО

### 1.1 RAF gate для `handleTableHover` — ✅

**Файл:** `src/features/matrix/MatrixView.svelte:90-93, 452-465`

- `hoverFrame` + `pendingHoverEvent` + `flushTableHover` через `requestAnimationFrame`

### 1.2 RAF gate для `flushPointerDrag` — ✅

- Уже было: `pendingDragPoint` + `dragFrame`

---

## Phase 2: Worker Message Optimization — ⚠️ ЧАСТИЧНО

### 2.1 Не передавать source при каждом search — ❌ НЕ ВЫПОЛНЕНО

**Файл:** `src/features/matrix/MatrixView.svelte`

Worker возвращает `cells` (массив пар `[key, entryIndexes]`), `adapter.buildCellMap` пересоздаёт Map при каждом search.

**Решение:** worker должен возвращать `Set<string>` (только ключи matched cells). `getVisibleCell` проверяет `cellByKey.has(key)` вместо пересоздания Map.

**Примечание:** filter модифицирует ячейки (подмножество entries через `entryIndexes`). Компромисс — in-place update `cellByKeyInternal` Map вместо полной замены.

### 2.2 Transferable ArrayBuffer — ❌ НЕ ВЫПОЛНЕНО

**Файл:** `src/features/matrix/matrixWorkerClient.ts`

Конвертировать `cells` в compact `keys`/`indexes` arrays перед `postMessage`.

**Приоритет:** низкий. Основной win от Phase 0.

### 2.3 Кэшировать `searchResultCache` дольше — ✅

**Файл:** `src/features/matrix/MatrixView.svelte:62`

- `SEARCH_CACHE_TTL_MS = 30_000` (30 секунд)

---

## Phase 3: Analytics Memoization — ✅ ВЫПОЛНЕНО

### 3.1 `hierarchyCache` WeakMap — ✅

**Файл:** `src/features/analytics/analyticsIndex.ts:51-56`

### 3.2 Debounce search в AnalyticsView — ✅

**Файл:** `src/features/analytics/AnalyticsView.svelte:59, 79`

### 3.3 Optimistic `setInput` — ✅

### 3.4 Optimistic `savingRows` / `saveStatus` — ✅

### 3.5 Интервал `today` → 10 минут — ✅

**Файл:** `src/features/analytics/AnalyticsView.svelte:72`

- `600_000ms`

---

## Phase 4: matrixFilter Optimization — ⚠️ ЧАСТИЧНО

### 4.1 Кэш `roomSearchKeyCache` — ✅

**Файл:** `src/features/matrix/matrixFilter.ts:12`

### 4.2 Оптимизация `entryIndexes` accumulation — ❌ НЕ ВЫПОЛНЕНО

**Файл:** `src/features/matrix/matrixFilter.ts`

Текущий код создаёт промежуточные массивы через `Array.from()` при первом non-match. Оптимизация: два прохода — подсчёт matchCount, затем заполнение entryIndexes.

### 4.3 `Object.keys` вместо `Object.entries` — ✅

**Файл:** `src/features/matrix/matrixFilter.ts:93, 97, 143, 147`

---

## Phase 5: ScheduleStore Index Optimization — ❌ НЕ НАЧАТО

**Цель:** уменьшить время построения индекса и размер clone при передаче в worker.

**Impact:** -50% startup time, -30% GC pressure.

### 5.1 Lazy week-based index building

**Файл:** `src/stores/scheduleStore.ts`

Строить `roomOccupancyByWeek` / `teacherOccupancyByWeek` только для текущей недели. Остальные — по demand.

### 5.2 Оптимизировать clone в `scheduleIndexWorker`

**Файл:** `src/stores/scheduleIndexWorker.ts`

Использовать Transferable для TypedArray.

### 5.3 Кэшировать `roomCell`/`teacherCell` результаты

**Файл:** `src/stores/scheduleStore.ts`

Кэшировать по content hash, а не по ссылке на `entries`.

---

## Phase 6: DOM Optimization — ❌ НЕ НАЧАТО

**Цель:** уменьшить размер DOM и количество layout/paint.

**Impact:** -30% Paint count, -20% Layout time.

### 6.1 `content-visibility` на строки

Уже описано в Phase 0.9.

### 6.2 Снизить z-index на sticky ячейках

**Файл:** `src/index.css:749, 758`

Текущий `z-index: 24` → `z-index: 1`. Каждая sticky ячейка создаёт отдельный stacking context.

### 6.3 Убрать `shadow-md` с `.slot-badge`

**Файл:** `src/index.css:1158-1159`

Badge 14×14px, shadow не заметен, но создаёт repaint.

---

## Phase 7: GC Pressure Reduction — ❌ НЕ НАЧАТО

**Цель:** уменьшить количество MajorGC и их длительность.

**Impact:** -50% GC time, -20% frame drops.

### 7.1 `searchResultCache` TTL — ✅ (выполнено в Phase 2.3)

### 7.2 Переиспользовать `cellByKeyInternal` Map — ✅

Map уже переиспользуется через `.clear()` + `.set()`.

### 7.3 Batch state updates через microtask

**Файл:** `src/features/matrix/MatrixView.svelte`

Обновлять `columnMatch` через `queueMicrotask()` вместо прямого присваивания в `applyFilterResult`.

---

## Phase 8: ScheduleView Optimization — ❌ НЕ НАЧАТО

**Цель:** уменьшить DOM в ScheduleView при большом количестве уроков.

**Impact:** -20% ScheduleView render time.

### 8.1 `content-visibility` на строки ScheduleView

**Файл:** `src/features/schedule/ScheduleView.svelte`

```css
.dense-table tbody tr {
  content-visibility: auto;
  contain-intrinsic-size: 0 2.5rem;
}
```

---

## Сводка выполнения

| Phase | Статус | Impact | Effort |
|---|---|---|---|
| 0 CSS Hot Path | ✅ 90% (кроме 0.9) | 🔴 Критический | 🟢 Низкий |
| 1 MouseMove Throttling | ✅ 100% | 🔴 Высокий | 🟢 Низкий |
| 2 Worker Messages | ⚠️ 33% (только 2.3) | 🟡 Средний | 🟡 Средний |
| 3 Analytics Memoization | ✅ 100% | 🟡 Средний | 🟢 Низкий |
| 4 matrixFilter | ⚠️ 66% (кроме 4.2) | 🟡 Средний | 🟢 Низкий |
| 5 Store Index | ❌ 0% | 🟡 Средний | 🔴 Высокий |
| 6 DOM Optimization | ❌ 0% | 🟡 Средний | 🟢 Низкий |
| 7 GC Pressure | ⚠️ 66% (кроме 7.3) | 🟢 Низкий | 🟢 Низкий |
| 8 ScheduleView | ❌ 0% | 🟢 Низкий | 🟢 Низкий |

**Общий прогресс: ~68%**

---

## Рекомендуемый порядок оставшейся работы

| # | Задача | Phase | Сложность |
|---|---|---|---|
| 1 | `content-visibility: auto` на строки матрицы | 0.9 | 🟢 |
| 2 | Снизить z-index sticky ячеек | 6.2 | 🟢 |
| 3 | Убрать shadow со `.slot-badge` | 6.3 | 🟢 |
| 4 | `content-visibility` на ScheduleView | 8.1 | 🟢 |
| 5 | Batch `columnMatch` через microtask | 7.3 | 🟢 |
| 6 | Оптимизация `entryIndexes` в matrixFilter | 4.2 | 🟢 |
| 7 | Worker compact Set вместо Map | 2.1 | 🟡 |
| 8 | Transferable ArrayBuffer для worker | 2.2 | 🟡 |
| 9 | Lazy week-based index building | 5.1 | 🔴 |
| 10 | Кэшировать roomCell/teacherCell | 5.3 | 🔴 |

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
