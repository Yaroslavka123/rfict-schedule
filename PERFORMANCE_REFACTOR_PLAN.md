# PERFORMANCE_REFACTOR_PLAN v4

Дата актуализации: 2026-06-06.
Основано на: v3 (95% выполнено), Chrome trace `Trace-20260606T154502.json`, ручном анализе кода.
Цель: радикально увеличить производительность, не меняя UI/функциональность.

---

## 0. Контекст и базовые метрики

**Состояние v3 (заархивировано в `PERFORMANCE_REFACTOR_PLAN_V3_ARCHIVE.md`):**
- 11 фаз: 4 выполнены на 100% (5, 6, 7, 9 — matrix extraction, tooltip, DnD cache, lib split), 7 имеют точечные остатки.
- Дублирование матриц ликвидировано (`RoomsView.svelte` 25 строк, `TeachersView.svelte` 25 строк).
- `lib/` split готов: `schedule/{normalize,filterLessons,planFact,stats,subgroups}.ts` + `utils/{classes,format,searchText}.ts`.
- Аналитика получила `analyticsIndex.ts` с `buildAnalyticsIndex` + `buildPlanFactHierarchy`.

**Найденные узкие места из trace `Trace-20260606T154502.json` (73.8 с, 726 186 событий, Vite dev):**

| # | Узкое место | Свидетельство из trace | Где в коде |
|---|---|---|---|
| B1 | **Click EventDispatch 1.3 с** | `+39.489s` click → `handle_event_propagation` 1071 мс; `+16.239s` click → 825 мс; `+45.799s` click → 464 мс | Глобальная Svelte 5 event delegation; матрица 2400+ `<td>` |
| B2 | **TimerFire 800-940 мс** | `+3.262s` TimerFire=17 → 940 мс; `+25.366s` TimerFire=74 → 795 мс; `+56.250s` TimerFire=183 → 790 мс | `scheduleStore.fetch` при SSE retry + `AnalyticsView` setInterval(60s) |
| B3 | **Search input 80-90 мс на keystroke** | 12 keypress/textInput/input событий по 80-90 мс в районе +60s | `App.svelte` debounce цепочка → worker fallback → `new Map(cellByKey)` → re-render 2400+ ячеек |
| B4 | **UpdateLayoutTree 56-70 мс** | топ 70 мс на renderer main; `LocalFrameView::performLayout` 2.5 с суммарно | Шаблон матрицы с 2400+ `<td>`, каждая вызывает 5+ adapter функций |
| B5 | **Paint 75 мс** | топ 75 мс | `transition` + `transform` в hover у 13 селекторов |
| B6 | **GPUTask 89.7 мс top, 16.3 с total** | 4370 GPU-задач | `filter: saturate` + `box-shadow` + `backdrop-filter` в плотной матрице |
| B7 | **`animate:flip` на 50-100 заголовках матрицы** | `+0.0s - 0.5s` серия `UpdateLayer` при DnD drop | `MatrixView.svelte:539` `animate:flip={{ duration: 170 }}` на каждом `<th>` |
| B8 | **CSS hot-path** | 31 `transition:`, 13 `transform:`, 31 hover-scale/translate | `index.css`: App-tab (199-247), FilterSelect (347-409), brand-mark (444), stat-pill (1107-1116), card (1143-1146), plan-toggle (1290-1295) |
| B9 | **`cn()` × 2400+ × 5 props × N re-renders** | много мелких class-merge вызовов | `MatrixView.svelte:489-494, 540-549, 588-598, 606-612` — `cn(...)` на каждой ячейке при каждом рендере |
| B10 | **Analytics `setInterval(60s)` ребилдит иерархию** | `+3.262s/25.366s/56.250s` каждые 22-30 с — возможно этот таймер | `AnalyticsView.svelte:65-72`: `today` change → `buildPlanFactHierarchy` → все `courseRows` |
| B11 | **scheduleStore index в main thread** | `v8.callFunction` 19.5 с суммарно, `FunctionCall` 11.3 с | `scheduleStore.ts:331-490` `buildScheduleIndex` — O(N×M) на 5000+ уроков, 16 недель, 2 матрицы |
| B12 | **`new Map(cellByKey)` на каждое нажатие поиска** | видим как часть B3 | `MatrixView.svelte:184` `cellByKey = currentSource ? adapter.buildCellMap(currentSource, result.cells) : null` |
| B13 | **95 long task > 50 мс** | 61 в 50-100 мс, 34 в >100 мс | сумма B1-B11 |
| B14 | **0 layout shifts** ✅ | `LayoutShift` events: 0 | уже хорошо |

**Целевые метрики после v4:**

| Метрика | Сейчас (dev) | Цель (prod) |
|---|---|---|
| Click EventDispatch (single) | 1000+ мс | < 50 мс |
| TimerFire > 100 мс | 6+ заходов | 0 |
| Search keystroke latency | 80-90 мс | < 16 мс |
| UpdateLayoutTree | 56-70 мс | < 20 мс |
| Paint | 75 мс | < 30 мс |
| GPUTask top | 89.7 мс | < 20 мс |
| Long tasks > 50 мс (за 73 с) | 95 | < 10 |
| Main thread RunTask сумма | 135.6 с | < 40 с |

**Что НЕ меняем (preserve functionality):**
- Внешний API, типы, контракты stores, события Svelte.
- UI/визуал: те же классы, та же DOM-структура, те же селекторы (если возможно — только CSS).
- localStorage keys: `rfict-room-order`, `rfict-teacher-order`, `rfict-room-groups`, `rfict-teacher-groups`, `rfict-theme`, `rfict-cache-*`.
- Google Sheet URL формат, API endpoints.
- Адаптеры (`RoomAdapter`, `TeacherAdapter`) — расширяем, не ломаем.
- Поведение фильтров, поиска, drag-and-drop, плана-факта, SSE refresh.

---

## 1. Архитектурные принципы v4

1. **Никаких ребилдов больших объектов на горячих путях.** `cellByKey`, `columnMatch`, `courseRows`, `MatrixHitTestCache` — мемоизированные WeakMap/Map, не `new` на каждый эффект.
2. **Реактивность минимальна.** `cn()`, `adapter.*` вызовы выносятся из шаблона в `derived`/`memoize`; шаблон видит только предвычисленные значения.
3. **CSS-анимации — только на compositor layer, без `width/height/top/left/box-shadow/filter`.** Hover-эффекты — через `background-color`, `border-color`, `opacity` (opacity GPU-friendly, background-color — cheap repaint, не composite).
4. **Layout избегает O(N) итераций по DOM.** `MatrixHitTestCache` уже есть — расширяем на поиск, scroll-snap, видимость ячеек.
5. **Длинные вычисления — в Worker или `requestIdleCallback`**, никогда в основном тике.
6. **Per-cell вычисления — кешируются на стадии build индекса.** `RoomCell.first` уже есть; добавим `RoomCell.precomputedMain`, `RoomCell.precomputedMeta`, `RoomCell.precomputedMainClass`, `RoomCell.precomputedBadgeKey`, `RoomCell.precomputedSheetId`.
7. **`animate:flip` остаётся** (это визуальный эффект, не функциональность), но **только когда реально идёт drop**, не на каждое изменение `orderedColumns`.

---

## 2. Дорожная карта v4 (фазы 12-22)

| # | Фаза | Узкие места | Цель | Трудозатраты |
|---|---|---|---|---|
| **12** | **Production trace + baseline** | все | снять prod-trace, зафиксировать baseline метрики | 0.25 д |
| **13** | **Per-cell render cache** | B4, B9, B12 | вынести adapter.* вызовы из шаблона в precomputed поля | 1 д |
| **14** | **Стабильный cellByKey + columnMatch** | B3, B12 | не пересоздавать Map/Set на каждое нажатие | 0.5 д |
| **15** | **Search keystroke pipeline** | B3 | debounce→idle→worker с throttle, отмена устаревших | 0.5 д |
| **16** | **CSS hot-path rewrite** | B5, B6, B8 | убрать 13 transform-hover, transition на 2400+ ячейках | 0.5 д |
| **17** | **Svelte 5 event delegation bypass** | B1 | обойти handle_event_propagation на горячих элементах | 0.5 д |
| **18** | **Analytics tick decouple** | B2, B10 | `today` тикает без пересборки иерархии | 0.5 д |
| **19** | **scheduleStore index в Worker** | B2, B11 | `buildScheduleIndex` вне main thread | 1 д |
| **20** | **animate:flip throttling** | B7 | flip-анимация только на реальных drop, не на change | 0.25 д |
| **21** | **Dev-mode guard + final perf** | B5, B6 | отключить Vite source maps для prod, set `NODE_ENV=production` | 0.25 д |
| **22** | **Final QA + docs v4** | — | `npm run check && build && lint`, обновить `PROJECT_DOCUMENTATION.md` | 0.5 д |

**Суммарно: ~5.5 рабочих дня, 11 коммитов.**

---

### Phase 12: Production trace + baseline (0.25 д)

**Цель:** убрать неопределённость dev vs prod и зафиксировать baseline.

**Действия:**
1. `npm run build` — собрать production build.
2. `npm run preview` — запустить на 4173.
3. Открыть в Chrome, DevTools → Performance → "Save trace".
4. Прогнать сценарий 73 с (как в исходном trace): навигация, переключение всех 4 вкладок, поиск, drag колонки, редактирование плана.
5. Записать в `docs/perf-baseline-20260606-prod.json` ключевые метрики: `click_dispatch_p99`, `timerfire_p99`, `update_layout_tree_p99`, `paint_p99`, `gputask_top`, `long_tasks_50ms_count`.
6. Сравнить dev-vs-prod: ожидание — handle_event_propagation в prod будет 50-150 мс (вместо 1.3 с). Если да, B1 — частично dev-артефакт, Phase 17 можно упростить.

**Файлы:** нет (только запись baseline в `docs/`).

**DoD:** `docs/perf-baseline-20260606-prod.json` существует; в нём все 6 метрик.

---

### Phase 13: Per-cell render cache (1 д)

**Цель:** устранить B4 (UpdateLayoutTree 56-70 мс) и B9 (`cn()` × 2400+) путём предвычисления всех adapter-полей в момент создания индекса.

**Действия в `src/stores/scheduleStore.ts`:**

1. Расширить интерфейс `RoomCell`:
   ```ts
   export interface RoomCell {
     entries: RoomSlotEntry[]
     allCancelled: boolean
     types: LessonType[]
     groups: string[]
     teachers: string[]
     first: RoomSlotEntry
     // precomputed for render
     precomputedKey: string                // roomSlotKey(room, day, pair)
     precomputedMain: string               // shortenSubject(first.subject)
     precomputedMainClass: string | null   // 'line-through' | null
     precomputedMeta: string | null        // groups[0] || null
     precomputedBadgeKey: string | null    // `${tCount}-${gCount}` or null
     precomputedBusyClasses: string[]      // [typeClass(cell)]
     precomputedSheetId: string | null     // getSheetId(entries)
     precomputedHasSheet: boolean
     precomputedIsMultiTeacher: boolean
     precomputedIsMultiGroup: boolean
     precomputedTeacherCount: number
     precomputedGroupCount: number
   }
   ```
2. Аналогично для `TeacherCell`:
   ```ts
   export interface TeacherCell {
     entries: TeacherSlotEntry[]
     allCancelled: boolean
     types: LessonType[]
     rooms: string[]
     // precomputed
     precomputedKey: string
     precomputedMain: string               // shortenSubject(first.subject)
     precomputedMainClass: string | null
     precomputedMeta: string | null        // rooms[0] || null
     precomputedSheetId: string | null
     precomputedHasSheet: boolean
   }
   ```
3. В `roomCell()` (scheduleStore.ts:287-299) заполнить все поля.
4. В `teacherCell()` (scheduleStore.ts:301-310) заполнить все поля.

**Действия в `src/features/matrix/RoomAdapter.ts`:**

1. `getCellMain` → возвращает `(cell as RoomCell).precomputedMain`.
2. `getCellMeta` → возвращает `(cell as RoomCell).precomputedMeta`.
3. `getCellMainClass` → возвращает `(cell as RoomCell).precomputedMainClass`.
4. `getCellBadges` → возвращает массив из 0-2 элементов на основе `precomputedIsMultiTeacher`/`precomputedIsMultiGroup` (без `new Set`).
5. `getSheetId` → возвращает `(cell as RoomCell).precomputedSheetId`.
6. `getBusyCellClasses` → возвращает `(cell as RoomCell).precomputedBusyClasses`.

**Действия в `src/features/matrix/TeacherAdapter.ts`:** аналогично.

**Действия в `src/features/matrix/MatrixView.svelte`:**

1. В шаблоне `cell` (line 600-633) заменить все `adapter.getXxx(cell)` на прямые `cell.precomputedXxx`.
2. `cn(...)` вызовы (line 606-612) заменить на конкатенацию массива `cell.precomputedBusyClasses + groupSlotClasses(slot) + matrixColumnClass(slotIndex)`. `cn()` — это join с trim, для 3-4 строк дешевле сделать `filter(Boolean).join(' ')`.

**Метрика успеха:**
- UpdateLayoutTree: 56-70 мс → **< 20 мс**
- Adapter function calls на ре-рендер: 5 × 2400 = 12000 → 0

**Файлы:**
- `src/stores/scheduleStore.ts` (RoomCell, TeacherCell, roomCell, teacherCell).
- `src/features/matrix/RoomAdapter.ts` (все get*).
- `src/features/matrix/TeacherAdapter.ts` (все get*).
- `src/features/matrix/MatrixView.svelte` (шаблон 600-633).

**DoD:** `npm run check` зелёный, `cell.precomputedXxx` присутствуют, adapter.getCellMain не вызывается из шаблона (можно проверить regex).

---

### Phase 14: Стабильный cellByKey + columnMatch (0.5 д)

**Цель:** B3, B12 — `cellByKey` Map не пересоздаётся на каждое нажатие, переиспользуется между вызовами.

**Действия в `src/features/matrix/matrixFilter.ts`:**

1. Протокол воркера сейчас: `result.cells: [key, entryIndexes[]][]` — массив пар. На выходе adapter строит `Map<key, RoomCell>`. **Перестроить протокол:** воркер возвращает `Uint32Array` индексов + `Map<key, number>` (single index в cells). main thread делает `cellByKey.set(key, source.occupancy[r][d][p])` — **без аллокации нового RoomCell**.
2. `filterRoomMatrix`/`filterTeacherMatrix`: при пустом фильтре возвращать `{ cells: null, matches: null }` (уже так).
3. **Проверить:** `source.occupancy[room][day][pair]` — RoomCell. После `applyFilterResult` нужно **взять тот же RoomCell** из source и положить в cellByKey. `entryIndexes` нужен только если ячейка **частично** совпала (часть entries подходит, часть нет). В большинстве случаев ячейка совпадает целиком → `cellByKey.set(key, sourceCell)`.
4. Если `entryIndexes.length === cell.entries.length` → полная копия; иначе — собрать filtered entries и создать упрощённый объект `{ entries: filtered, first: filtered[0] }`. **Только для частично совпавших ячеек.**

**Действия в `src/features/matrix/MatrixView.svelte`:**

1. `cellByKey` — переиспользуемая Map, не новая:
   ```ts
   const cellByKeyInternal = new Map<string, RoomCell | TeacherCell>()
   let cellByKey = $state<Map<...> | null>(null)
   ```
2. В `applyFilterResult`: очищать только нужные ключи (которых нет в новом cells), либо просто пересоздавать — но **не делать это при отсутствии изменений**.
3. **Кеш по `(query, types, groupFilter)`:**
   ```ts
   const searchResultCache = new Map<string, { result: FilterResult; ts: number }>()
   ```
   Ключ: `${activeGroup}|${query}|${types.join(',')}`. TTL: 5 с. При совпадении — вернуть кеш, не считать.
4. **Worker postMessage throttling:** если последний запрос был < 50 мс назад, отложить через `setTimeout(50)`.

**Файлы:**
- `src/features/matrix/matrixFilter.ts`.
- `src/features/matrix/matrixWorkerClient.ts`.
- `src/features/matrix/MatrixView.svelte` (applyFilterResult, searchRequestId, cellByKey management).

**DoD:**
- На одинаковый ввод (например, "abc" → backspace → "abc") повторного пересчёта нет.
- `cellByKey` Map instance переиспользуется, GC pressure падает.

---

### Phase 15: Search keystroke pipeline (0.5 д)

**Цель:** B3 — keystroke latency 80-90 мс → < 16 мс.

**Действия в `src/App.svelte`:**

1. **Search input публикует немедленно** (line 89-102) — `filters.search = event.currentTarget.value` в `oninput`. `debouncedSearch` через 120 мс. Это OK.
2. **Проверить, что `searchSuggestion` не блокирует main** (line 104-127). Сейчас 80 мс debounce + `requestIdleCallback` — OK. Но `firstSearchSuggestion` итерирует candidates (могут быть 200+). Добавить ранний выход при `candidate.normalized.length < normalizedQuery.length`.
3. **`scheduleDeferred` (line 166-174)** — оставить как есть.

**Действия в `src/features/matrix/MatrixView.svelte`:**

1. `$effect` на search (line 102-156): сейчас `scheduleFallbackSearch(..., 240)` (line 144). **Уменьшить до 60 мс** — при быстром наборе первая буква даст результат быстрее, не будет «лага».
2. **Кеш результатов в Worker** (Phase 14) — главный выигрыш.
3. **`normalizedSearch` пересчитывается** на каждое нажатие через `normalizeSearchQuery(search)` (line 84). Нормировка дешёвая, но если поиск пустой — early return:
   ```ts
   let normalizedSearch = $derived(search ? normalizeSearchQuery(search) : '')
   ```

**Действия в `src/features/matrix/matrixFilter.ts`:**

1. `roomEntryMatches` (line 30-34): `entry.searchKey.includes(query)` — `searchKey` уже нормализован, O(n). OK.
2. **Кеш roomSearchKeys:** `Map<room, string>` — переиспользовать между вызовами.
3. **Если `query.length === 0` и `activeGroup === 'all'` и `types.length === 0`:** возвращать `{ cells: null, matches: null }` (уже так, line 49).

**Действия в `src/lib/utils/searchText.ts`:**

1. **Проверить `normalizeSearchQuery` на холодный путь** — `buildSearchKey` использует regex `/[^\p{L}\p{N}]+/gu`. Может быть медленным на длинных строках. **Добавить fast-path:**
   ```ts
   if (text.length < 3) return text.toLowerCase()
   ```
2. **Кеш по `text`** через `WeakMap<string, string>` (только для строк длиной > 3, иначе хеш дороже).

**Файлы:**
- `src/App.svelte` (line 102-127 — searchSuggestion pipeline).
- `src/features/matrix/MatrixView.svelte` (line 102-156 — search effect, normalizedSearch).
- `src/features/matrix/matrixFilter.ts` (roomEntryMatches, cache).
- `src/lib/utils/searchText.ts` (fast-path + кеш).

**DoD:** Production trace показывает < 16 мс на keypress; jank 80-90 мс исчезает.

---

### Phase 16: CSS hot-path rewrite (0.5 д)

**Цель:** B5, B6, B8 — убрать 13 `transform:` в hover/active, `transition` в плотной матрице.

**Действия в `src/index.css`:**

Заменить **transform/hover-scale** на cheap color/border effects (НЕ меняется визуал поведения, но убирается compositor layer).

| Строка | Было | Стало |
|---|---|---|
| **199-203** | `.app-tab transition: ..., transform 160ms` | `transition: color 160ms, background-color 160ms, box-shadow 180ms` (убрать transform) |
| **215-219** | `.app-tab::after transition: transform 280ms, opacity 200ms` | **Оставить** (композитный слой один раз, OK) |
| **221-223** | `.app-tab:hover transform: translateY(-1px)` | `.app-tab:hover { background-color: hsl(var(--muted)/0.6) }` |
| **224-226** | `.app-tab:active transform: translateY(0) scale(0.97)` | `.app-tab:active { background-color: hsl(var(--muted)) }` |
| **243-245** | `.app-tab:hover .app-tab-icon transform: scale(1.12) rotate(-3deg)` | `.app-tab:hover .app-tab-icon { color: hsl(var(--primary)) }` |
| **285-291** | `.filter-field transition: flex-basis, width, opacity, transform 200ms, margin` | `transition: flex-basis, width, opacity, margin` (убрать transform) |
| **292-294** | `.filter-field:focus-within transform: translateY(-1px)` | `.filter-field:focus-within { border-color: hsl(var(--primary)/0.5) }` |
| **347-352** | `.filter-select-trigger transition: ..., transform 160ms` | `transition: border-color, background-color, box-shadow` (убрать transform) |
| **359-361** | `.filter-select-trigger:active transform: scale(0.985)` | убрать |
| **391** | `.filter-select-option transition: ..., transform 120ms` | `transition: background-color, color` |
| **394-397** | `.filter-select-option:hover transform: translateX(2px)` | убрать (background-color уже есть) |
| **407-409** | `.filter-select:active transform: scale(0.99)` | убрать |
| **444** | `.brand-mark:hover transform: translateY(-50%) scale(1.18) rotate(-8deg)` | `.brand-mark:hover { background-color: hsl(var(--primary)/0.12) }` |
| **553-563** | `@keyframes tab-view-in` (если ещё есть) | **Удалить** |
| **761-770** | `.matrix-drag-image` `transform: translate(-9999px, -9999px); will-change: transform` | **Оставить** (используется только при drag, не на горячем пути) |
| **800-808** | `.matrix-draggable-header transition: ..., transform` | `transition: background-color, color, opacity, box-shadow, outline-color` (убрать transform) |
| **997-1000** | `.slot-busy transition: ...` | проверить, что **нет transform** в списке; если есть — убрать |
| **999-1003** | `.slot-busy:hover transform: scale(1.025)` (если есть) | убрать |
| **1107-1116** | `.stat-pill transition: ..., transform` + `:hover transform: translateY(-2px)` | `transition: border-color, box-shadow` + `:hover { box-shadow }` |
| **1143-1146** | `.card transition: transform, ...` + `:hover transform: translateY(-2px)` | `transition: border-color, box-shadow` + `:hover { box-shadow }` |
| **1290-1295** | `.plan-toggle > svg transition: transform 240ms` + `:hover scale(1.2)` | `transition: color 200ms` + `:hover { color: hsl(var(--primary)) }` |
| **1361-1371** | `.card-slot transform: translateY(-1px)` (если есть) | `box-shadow` |

**CSS-правила которые НЕ трогаем (композитный слой нужен):**
- `transform: translate3d(...)` в `.matrix-drag-preview` (используется во время drag).
- `transform: translate3d(...)` в `.slot-tooltip` (используется во время hover).
- `view-transition-old(root)` / `view-transition-new(root)` (controlled CSS animation на drop).

**Файлы:** `src/index.css` (одна правка).

**Метрика успеха:**
- `transform:` в `:hover`/`:active` селекторах: 13 → 0
- GPUTask top: 89.7 мс → < 20 мс
- Paint p99: 75 мс → < 30 мс

**DoD:** regex `grep -n ':hover.*transform\|:active.*transform' src/index.css` возвращает 0 строк (кроме разрешённых).

---

### Phase 17: Svelte 5 event delegation bypass (0.5 д)

**Цель:** B1 — click EventDispatch 1.3 с → < 50 мс.

**Корневая причина:** Svelte 5 использует **event delegation** для всех `onclick` / `on:click` (но НЕ для `onpointerdown` и т.д.). Делегация — один обработчик на document/window, который итерирует DOM-дерево от target до root, ища зарегистрированные handlers. С матрицей 2400+ `<td>` это O(n × log n).

**Где происходит:**
- `AppShell.svelte`: `onclick` на tab buttons (~4 шт) — не проблема.
- `TopFilters.svelte`: `oninput` на search — не делегируется.
- `MatrixView.svelte`: `onpointerdown`/`onpointerup` напрямую — **не делегируется**, OK.
- `AnalyticsView.svelte`: `onclick` на toggle/save buttons (сотни) — **проблема**.
- `FilterSelect.svelte`: `onclick` на options — проблема при длинных списках.
- `App.svelte`: 4 `{#if}` div с `aria-hidden` — **нет onclick**, OK.

**Действия в `src/features/analytics/AnalyticsView.svelte`:**

1. Все `onclick={() => ...}` (line 543-555, 649-661, 858-870, 858+) → **заменить на `onpointerup` где возможно** (pointerup не делегируется в Svelte 5). Это консистентно с тем, что уже сделано в `MatrixView.svelte` (cell click).
2. Или: **оставить onclick, но добавить `e.stopPropagation()`** на каждом handler, чтобы делегация не поднималась.

**Действия в `src/components/ui/FilterSelect.svelte`:**

1. `onclick` на options (line 80+) — оставить, options обычно 5-20 шт, не проблема. **Не трогать.**

**Действия в `src/components/ui/Button.svelte`:**

1. Уже использует `onclick` — оставить. Buttons на странице < 30 шт.

**Действия в `src/App.svelte`:**

1. `onclick={scheduleStore.refresh}` (line 348) — OK.

**Действия в `src/features/schedule/ScheduleView.svelte`:**

1. Проверить, есть ли `onclick` на строках таблицы — если да, добавить `stopPropagation`.

**Альтернативное решение (если 1.3 с воспроизводится в prod):**

- **Глобально отключить Svelte 5 delegation для `onclick`:** невозможно, это internal Svelte 5.
- **Перейти на `on:click` (Svelte 4 syntax) с `|nonpassive` modifier:** нет, в Svelte 5 это не работает.
- **Использовать `addEventListener` через `bind:this`:** много рефакторинга, не стоит того.
- **Самый простой:** в `MatrixView.svelte:482` убрать делегацию, использовать только `addEventListener` через action. **Действия:**
  ```ts
  function tableHoverAction(node: HTMLElement) {
    node.addEventListener('pointermove', handleTableHover)
    node.addEventListener('mouseleave', hideTooltip)
    return {
      destroy() {
        node.removeEventListener('pointermove', handleTableHover)
        node.removeEventListener('mouseleave', hideTooltip)
      }
    }
  }
  ```
  ```svelte
  <table use:tableHoverAction>
  ```
  Аналогично для cells. **Это уже работает для pointer events, делегация — только для click.**

**Файлы:**
- `src/features/analytics/AnalyticsView.svelte` (onclick → onpointerup или stopPropagation).
- `src/features/schedule/ScheduleView.svelte` (если есть onclick).
- (Опционально) `src/features/matrix/MatrixView.svelte` — `use:` action для `pointermove` (но это уже не click).

**Метрика успеха:** Click EventDispatch p99: 1.3 с → < 50 мс.

**DoD:** Production trace, click на любую кнопку < 50 мс.

---

### Phase 18: Analytics tick decouple (0.5 д)

**Цель:** B2, B10 — `setInterval(60s)` в AnalyticsView не пересобирает всю иерархию.

**Действия в `src/features/analytics/AnalyticsView.svelte`:**

1. Заменить `setInterval(60_000)` на **EventTarget pattern**:
   ```ts
   $effect(() => {
     if (!active) return
     const interval = setInterval(() => {
       const nextStamp = todayStamp(new Date())
       if (nextStamp !== currentDayStamp) {
         currentDayStamp = nextStamp
         today = new Date(nextStamp)
       }
     }, 60_000)
     return () => clearInterval(interval)
   })
   ```
2. `currentDayStamp: number` — отдельный `$state`. Меняется только при смене календарного дня (UTC).
3. `today` (Date) — мемоизированный `new Date(currentDayStamp)`. Используется в `buildPlanFactHierarchy`.

**Действия в `src/features/analytics/analyticsIndex.ts`:**

1. `BuildIndexedPlanFactOptions` уже принимает `today?: Date` (line 46) — OK.
2. `isLessonBeforeToday` (line 58-63) — конвертирует `lesson.date` в Date. **Кешировать** `dayStamp(lesson.date)` через `WeakMap<ScheduleLesson, number | null>`. Только для active lessons.
3. **Структурный кеш (subjects × groups × subgroups сетка):**
   ```ts
   const structuralCache = new WeakMap<AnalyticsIndex, StructuralPlanFact[]>()
   ```
   Ключ: `AnalyticsIndex`. Значение: вся сетка **без** done numbers (только `planned`).
4. **Done numbers кеш:**
   ```ts
   const doneCache = new WeakMap<AnalyticsIndex, Map<number /* dayStamp */, Map<cellKey, number>>>()
   ```
   При `today` change — пересчитывается **только done numbers**, structural переиспользуется.
5. **Передавать в `buildPlanFactHierarchy` уже структурный кеш:**
   ```ts
   const structural = getStructural(index, plans)
   const done = getDone(index, dayStamp)
   const merged = mergeStructuralWithDone(structural, done, search)
   ```

**Файлы:**
- `src/features/analytics/AnalyticsView.svelte` (setInterval refactor).
- `src/features/analytics/analyticsIndex.ts` (structural/done split, dayStamp cache, WeakMap caches).

**Метрика успеха:** `setInterval` callback < 1 мс; full re-render только при смене дня (раз в сутки).

**DoD:** Production trace, AnalyticsView re-render = 0 на 60-s tick, 1 на 24-h tick.

---

### Phase 19: scheduleStore index в Worker (1 д)

**Цель:** B2, B11 — `buildScheduleIndex` (O(N×M)) вне main thread.

**Архитектура:**
1. Создать `src/stores/scheduleIndex.worker.ts` — воркер для построения индекса.
2. `scheduleStore.fetch` после получения данных от API → `postMessage({ schedule })` в воркер.
3. Воркер возвращает `ScheduleIndex` через `postMessage`.
4. Main thread: `store.set({ ..., index: workerResult })`.

**Сложности:**
- Воркер не может импортировать Svelte stores. Решение: воркер — чистая функция, импортирует `buildScheduleIndex` напрямую.
- `RoomCell`/`TeacherCell` теперь содержат precomputed поля (Phase 13) — это много объектов, structured clone может быть медленным. **Оптимизация:** использовать transferable objects (`ArrayBuffer`) или просто переложить на structured clone и замерить.
- Если `buildScheduleIndex` < 100 мс (а он сейчас в среднем 50-200 мс на 5000 уроков), оставлять в main thread. Если > 100 мс — в воркер.

**Действия:**

1. **Шаг 1 (замер):** в `scheduleStore.fetch` добавить `performance.now()` вокруг `getCachedScheduleIndex(bundle.schedule)`. Замерить в production.
2. **Шаг 2 (worker):** если > 100 мс:
   - Создать `src/stores/scheduleIndexWorker.ts`:
     ```ts
     self.onmessage = (event) => {
       const { id, schedule } = event.data
       const index = buildScheduleIndex(schedule)
       self.postMessage({ id, index })
     }
     ```
   - В `scheduleStore.ts`:
     ```ts
     const worker = new Worker(new URL('./scheduleIndexWorker.ts', import.meta.url), { type: 'module' })
     worker.onmessage = (event) => {
       const { id, index } = event.data
       const resolver = pendingRequests.get(id)
       if (resolver) {
         resolver(index)
         pendingRequests.delete(id)
       }
     }
     ```
   - `getCachedScheduleIndex` → асинхронный `getIndexAsync(schedule): Promise<ScheduleIndex>`.
3. **Шаг 3 (кеш):** `scheduleIndexCache: WeakMap` уже есть (line 159). Сохраняется между fetch.
4. **Шаг 4 (fallback):** если worker не инициализирован (SSR, edge case) — fallback в main thread.

**Файлы:**
- `src/stores/scheduleIndexWorker.ts` (новый).
- `src/stores/scheduleStore.ts` (fetch → worker postMessage).

**Метрика успеха:** main thread RunTask в `fetch` сокращается на величину `buildScheduleIndex` (50-200 мс × число вызовов).

**DoD:** Production trace, в `fetch` нет задач > 50 мс.

---

### Phase 20: animate:flip throttling (0.25 д)

**Цель:** B7 — flip-анимация только на реальных drop, не на каждом изменении `orderedColumns`.

**Текущий код (`MatrixView.svelte:539`):**
```svelte
<th animate:flip={{ duration: 170 }} ...>
```

Flip срабатывает при `key` change в `{#each columnSlots as slot, slotIndex (slot.id)}` (line 533). Если `slot.id` не меняется, Svelte не запускает flip. **Проверить стабильность `slot.id`:**

- `columnSlots` строится через `buildColumnSections` + `buildColumnSlots` (columnGroups.ts).
- Для колонок: `id: \`column:${column}\`` — стабилен.
- Для group: `id: \`group:${groupId}:${column}\`` — стабилен.
- Для group-empty: `id: \`group-empty:${groupId}\`` — стабилен.

Так что flip **должен срабатывать только при reorder**. Но `columnOrder` сохраняется в localStorage, и при первом mount из localStorage все IDs совпадают с теми, что были до загрузки. **Если порядок изменился из-за default reordering** (room 401 добавлен, его нет в saved order, он идёт в конец) — flip запустится на 50+ элементах.

**Действия в `src/features/matrix/MatrixView.svelte`:**

1. **Опционально отключить flip на initial mount:**
   ```ts
   let flipEnabled = $state(false)
   $effect(() => {
     if (active) {
       // enable after first paint
       requestAnimationFrame(() => { flipEnabled = true })
     } else {
       flipEnabled = false
     }
   })
   ```
2. В шаблоне:
   ```svelte
   {#if flipEnabled}
     <th animate:flip={{ duration: 170 }} ...>
   {:else}
     <th ...>
   {/if}
   ```
   **Но это дублирует код — лучше через `{#each}` key + `flip` параметр в `let:` переменной.** Svelte не поддерживает conditional animate:flip напрямую. **Решение:** использовать CSS-вместо-flip для initial load, оставить flip только для drops.
3. **Альтернатива:** вообще убрать `animate:flip` (это визуальный эффект, не функциональность). MatrixView и так даёт визуальный feedback через `flashDropped` (line 317-324) + `matrix-just-dropped` CSS class (index.css:856-860).

**Решение:** убрать `animate:flip` на header. Оставить только `flashDropped` (420 мс glow). Это убирает B7 целиком.

**Файлы:** `src/features/matrix/MatrixView.svelte` (line 539 — убрать `animate:flip`).

**DoD:** Production trace, 0 `animate:flip` task events на initial mount. DnD drop всё ещё даёт визуальный feedback через `flashDropped`.

---

### Phase 21: Dev-mode guard + final perf (0.25 д)

**Цель:** устранить Vite dev-артефакты, зафиксировать production build perf.

**Действия:**

1. `vite.config.ts`: убедиться, что `build.minify: 'esbuild'`, `build.cssMinify: true`, `build.target: 'es2022'`.
2. `vite.config.ts`: `esbuild.drop: ['console', 'debugger']` для production.
3. `svelte.config.js`: `compilerOptions.dev: false` (если есть).
4. `package.json`: `"build": "npm run check && tsc -b && vite build"` — проверить, что все шаги.
5. `src/main.ts`: убрать `console.log`/`console.debug` если есть.
6. `index.html`: `<meta http-equiv="x-ua-compatible" content="IE=edge">` если нет.
7. **Проверить, что нет `// @ts-ignore` в hot path** (через grep).

**Файлы:**
- `vite.config.ts`.
- `svelte.config.js` (если есть compilerOptions).
- `src/main.ts`.

**DoD:** Production bundle size не вырос; нет dev-only console.log.

---

### Phase 22: Final QA + docs v4 (0.5 д)

**Действия:**

1. `npm run check` — зелёный.
2. `npm run build` — успешный.
3. `npm run lint` — зелёный.
4. `npm run preview` — запуск, ручной smoke test:
   - Все 4 вкладки рендерятся без ошибок.
   - Поиск работает в rooms, teachers, analytics.
   - Drag-and-drop колонок + group drop работают.
   - Plan save optimistic + rollback работают.
   - Google Sheet open работает.
   - Theme switch работает.
   - SSE update работает (открыть в двух окнах, изменить в одном — обновить в другом).
   - localStorage миграции (room order, teacher order, groups, theme) работают.
5. **Снять production trace после v4**, записать в `docs/perf-after-20260606-prod.json`.
6. **Сравнить** baseline vs after:
   - click_dispatch_p99: 1300+ → ?
   - timerfire_p99: 940 → ?
   - keystroke_latency: 80-90 → ?
   - update_layout_tree_p99: 70 → ?
   - paint_p99: 75 → ?
   - gputask_top: 89.7 → ?
   - long_tasks_50ms: 95 → ?
7. **Обновить `PROJECT_DOCUMENTATION.md`:**
   - Phase 12-22 → добавить в раздел "Архитектура".
   - Section 13 "Производительность" → обновить с новыми метриками.
8. **Обновить `PERFORMANCE_REFACTOR_PLAN_V3_ARCHIVE.md` (README):** добавить ссылки на v4.

**Файлы:**
- `docs/perf-after-20260606-prod.json` (новый).
- `PROJECT_DOCUMENTATION.md` (обновить).
- `PERFORMANCE_REFACTOR_PLAN_V3_ARCHIVE.md` (README + ссылки на v4).

**DoD:** Все 4 вкладки работают, метрики записаны, документация обновлена.

---

## 3. Карта файлов — все правки v4

| Файл | Фаза | Что меняется |
|---|---|---|
| `src/stores/scheduleStore.ts` | 13, 19 | `RoomCell`/`TeacherCell` precomputed поля; worker integration |
| `src/stores/scheduleIndexWorker.ts` | 19 | новый файл |
| `src/features/matrix/MatrixView.svelte` | 13, 14, 17, 20 | precomputed поля в шаблоне; cellByKey reuse; action для hover; убрать animate:flip |
| `src/features/matrix/RoomAdapter.ts` | 13 | get* → precomputed |
| `src/features/matrix/TeacherAdapter.ts` | 13 | get* → precomputed |
| `src/features/matrix/matrixFilter.ts` | 14, 15 | кеш search results, throttle worker |
| `src/features/matrix/matrixWorkerClient.ts` | 14 | throttle, cache hits |
| `src/features/analytics/AnalyticsView.svelte` | 17, 18 | onclick → pointerup / stopPropagation; setInterval refactor |
| `src/features/analytics/analyticsIndex.ts` | 18 | structural/done split, dayStamp cache, WeakMap |
| `src/App.svelte` | 15 | searchSuggestion fast-path |
| `src/components/ui/FilterSelect.svelte` | — | не трогаем (options короткие) |
| `src/components/ui/Button.svelte` | — | не трогаем (buttons мало) |
| `src/components/ui/Card.svelte` | 16 | CSS — только `transform` → `box-shadow` (через index.css) |
| `src/components/layout/AppShell.svelte` | — | не трогаем (4 tab buttons) |
| `src/components/layout/TopFilters.svelte` | — | не трогаем (search input не делегируется) |
| `src/features/schedule/ScheduleView.svelte` | 17 | onclick → pointerup |
| `src/lib/utils/searchText.ts` | 15 | fast-path + WeakMap кеш |
| `src/lib/schedule/planFact.ts` | 18 | dayStamp helpers |
| `src/index.css` | 16 | 13 transform-hover → color/border, убрать transition:transform |
| `vite.config.ts` | 21 | esbuild minify, target es2022, drop console |
| `svelte.config.js` | 21 | compilerOptions.dev: false |
| `package.json` | 21 | build script verify |
| `docs/perf-baseline-20260606-prod.json` | 12 | новый |
| `docs/perf-after-20260606-prod.json` | 22 | новый |
| `PROJECT_DOCUMENTATION.md` | 22 | обновить v4 |
| `PERFORMANCE_REFACTOR_PLAN_V3_ARCHIVE.md` | 22 | README + ссылки |

**Итого: ~22 файла (3 новых, 19 правок), 11 коммитов, ~5.5 рабочих дня.**

---

## 4. Порядок коммитов

```
commit 1:  "perf(matrix): precompute render fields in RoomCell/TeacherCell"  (Phase 13)
commit 2:  "perf(matrix): reuse cellByKey and add search result cache"        (Phase 14)
commit 3:  "perf(matrix): throttle worker and dedupe search requests"         (Phase 15 part)
commit 4:  "perf(search): fast-path and WeakMap cache in normalizeSearchQuery" (Phase 15 part)
commit 5:  "perf(css): remove hover/active transforms from hot path"           (Phase 16)
commit 6:  "perf(svelte): bypass event delegation on analytics click handlers" (Phase 17)
commit 7:  "perf(analytics): decouple today tick from full hierarchy rebuild"  (Phase 18)
commit 8:  "perf(store): build schedule index in worker"                        (Phase 19)
commit 9:  "perf(matrix): drop animate:flip, keep flashDropped feedback"        (Phase 20)
commit 10: "perf(build): enable minify, drop console in production"            (Phase 21)
commit 11: "docs: update PROJECT_DOCUMENTATION.md and archive v3 plan"         (Phase 22)
```

---

## 5. Метрики успеха v4

| Метрика | До (dev) | Цель (prod) | Как измерить |
|---|---|---|---|
| Click EventDispatch p99 | 1300+ мс | < 50 мс | trace `EventDispatch` |
| TimerFire p99 | 940 мс | < 50 мс | trace `TimerFire` |
| Search keystroke latency | 80-90 мс | < 16 мс | trace `InputLatency::Key*` |
| UpdateLayoutTree p99 | 70 мс | < 20 мс | trace `UpdateLayoutTree` |
| Paint p99 | 75 мс | < 30 мс | trace `Paint` |
| GPUTask top | 89.7 мс | < 20 мс | trace `GPUTask` |
| Long tasks > 50 мс (за 73 с) | 95 | < 10 | trace `RunTask` with dur>50000 |
| Adapter function calls на matrix re-render | 5 × 2400 = 12000 | 0 | grep + manual count |
| animate:flip при initial mount | ~50 elements | 0 | визуально / trace |
| Search result cache hit rate (быстрый набор) | 0% | > 50% | instrument |

**Сценарии для trace после v4:**
- Открыть `/` → 3 с
- Переключение rooms → teachers → analytics → schedule, по 5 с на каждом
- Поиск "иванов" в rooms, очистка
- Drag-drop колонки 401 между группами
- Редактирование плана предмета, Enter → save
- 60 с idle (для проверки setInterval)

---

## 6. Что осознанно НЕ делаем в v4

- **Не трогаем `public/schedule/*` и `public/index.html`** (Phase 1 v3) — dead code, но не в hot path, не блокирует. Удаление в roadmap v5.
- **Не рефакторим `scheduleStore.ts` целиком** (он 21 КБ, монолит). Фаза 19 делает worker, но не split.
- **Не делаем virtualization матрицы** (рендер только видимых ячеек). Это радикальное изменение архитектуры, может в v5.
- **Не переписываем `FilterSelect` на Svelte 5 popover/portal** — мелкая проблема (короткие списки), не приоритет.
- **Не добавляем `vite-plugin-pwa` / offline** — не в scope.
- **Не делаем light-tree / useCallback** — Svelte 5 сам это делает.
- **Не оптимизируем `googleSheets.ts`** — это просто URL open, не perf-critical.
- **Не добавляем `requestAnimationFrame` в search input** — debounce 60 мс + worker + idle — достаточно.
- **Не выносим `analyticsIndex` в Worker** — Phase 18 кеширует структурную часть, этого достаточно. Worker для analytics — overkill.
- **Не делаем `memo` обёртки** — `$derived` в Svelte 5 уже мемоизирован.

---

## 7. Риски и контр-меры

| Риск | Вероятность | Импакт | Контр-мера |
|---|---|---|---|
| Production trace показывает, что 1.3 с click — dev-артефакт, Phase 17 бесполезен | средняя | низкий | Phase 12 baseline покажет. Если так — Phase 17 упрощаем. |
| `animate:flip` убрать, drag-drop станет «сухим» | низкая | низкий | `flashDropped` (420 мс glow) + `matrix-just-dropped` CSS дают визуальный feedback. |
| `RoomCell` precomputed поля увеличат JSON-размер в localStorage | низкая | низкий | `cached.schedule` хранит только `lessons` + `groups` + `weeks` (не `index`). `index` пересоздаётся. См. `scheduleStore.ts:206-224` — кешируется schedule, не index. |
| WeakMap кеш `analyticsIndex` теряется при перезагрузке | средняя | низкий | WeakMap создаётся заново при каждом fetch. Это OK — кеш только на время жизни. |
| Worker `scheduleIndexWorker.ts` не работает в SSR | средняя | низкий | `typeof Worker === 'undefined'` fallback в main thread. |
| Vite build target `es2022` ломает старые браузеры | низкая | средний | Проверить browserslist в `package.json`. |
| CellByKey Map не очищается при смене недели — stale data | средняя | высокий | `cellByKey = null` в effect при смене `source` (уже есть, line 116-119). |

---

## 8. Definition of Done v4 (общий)

1. `npm run check` — зелёный.
2. `npm run build` — успешный, размер бандла не вырос > 5%.
3. `npm run lint` — зелёный.
4. **Production trace** (после Phase 22) показывает:
   - 0 click EventDispatch > 100 мс
   - 0 TimerFire > 50 мс
   - 0 long tasks > 100 мс
   - UpdateLayoutTree p99 < 20 мс
   - Paint p99 < 30 мс
   - GPUTask top < 20 мс
5. **Все 4 вкладки** функционально идентичны v3 (никаких UI/UX изменений).
6. **Все 3 store** (`scheduleStore`, `columnOrder`, `columnGroups`) сохраняют свои сигнатуры.
7. **localStorage** keys не изменились.
8. **Google Sheet URL** формат не изменился.
9. **SSE events** не изменились.
10. **Drag-and-drop** поведение не изменилось (только убран `animate:flip`, оставлен `flashDropped`).
11. **Plan save** optimistic + rollback работают.
12. **Tooltip** рендерится идентично.

**Готово, когда prod-trace показывает < 10% от baseline по всем метрикам.**

---

## 9. Связь с v3

| Фаза v3 | Статус | Перенесена в v4? |
|---|---|---|
| Phase 1 (dead code) | 60% | Частично: `public/schedule/*` удаление — v5. |
| Phase 2 (worker search) | 80% | Уточнена в Phase 14-15 v4. |
| Phase 3 (CSS hot-path) | 75% | Доработана в Phase 16 v4. |
| Phase 4 (tab state) | 95% | Закрыта: `tab-view-in` keyframe удалён в Phase 16. |
| Phase 5 (matrix core) | 100% | — |
| Phase 6 (tooltip summary) | 100% | — |
| Phase 7 (DnD cache) | 100% | — |
| Phase 8 (analytics index) | 90% | Доработана в Phase 18 v4. |
| Phase 9 (lib split) | 100% | — |
| Phase 10 (animation polish) | 30% | Полностью в Phase 16 v4. |
| Phase 11 (docs) | 50% | Закрыта в Phase 22 v4. |

**v4 закрывает все остатки v3 + 9 новых узких мест из trace.**

---

Конец v4.
