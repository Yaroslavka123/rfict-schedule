# RFICT Schedule: roadmap по остаточной оптимизации (v3)

Дата: 2026-06-06. Этот документ **переписывает** v2 с учётом уже выполненной работы
(коммиты `72f8b66`, `947cbda`, `7aedf76`, `b79a411`).

## 0. Главное ограничение

**Функционал не меняется ни в одной фазе.**

- Видимый UI/UX, API-контракт, эндпоинты, backend, Apps Script, Vite proxy,
  ESLint/TS/Tailwind конфиги — не трогаем.
- Изменения только в реализации.

## 1. Что сделано в v2

Сжатая сводка по коммитам `72f8b66`, `947cbda`, `7aedf76`, `b79a411`.

- **Phase 1 (60%):** `Highlight.svelte` и `GlobalFilters.svelte` удалены.
  `WEEKS` в `lib/constants.ts` уже отсутствовал.
- **Phase 2 (80%):** `matrixSearchWorker.ts` превратился в 56-строчный
  диспетчер, фильтрация вынесена в `lib/matrixFilter.ts`
  (`filterRoomMatrix` / `filterTeacherMatrix`). Main-thread хранит
  `roomCellByKey: Map<key, RoomCell>` и `roomMatch: Set<string>`. Источник
  `RoomOccupancyIndex` остаётся стабильным, пересылается только при смене.
  Fallback 240 мс через `requestIdleCallback` оставлен.
- **Phase 3 (75%):** убраны `::before` сетка с `mask-image` на
  `.slot-column-match`, `transform: scale(1.025)` на `.slot-busy:hover`,
  постоянные `will-change`, `backdrop-filter: blur(8px)` на sticky thead.
  Остался один `will-change: transform` — на `.matrix-drag-preview` во время
  drag (что и требовалось).
- **Phase 4 (95%):** `renderedTab` / `switchingTab` / `tabSwitchTimer` /
  `setTimeout(165мс)` / `in:tabEnter` / `out:tabExit` — удалены. Все 4
  вкладки смонтированы одновременно, переключение через `display: none`
  (`tab-view-active` vs `tab-view-hidden`).
- **Phase 7 (100%):** `createMatrixHitTestCache` + `resolveFromCache` в
  `lib/matrixDrag.ts:61-120`. `elementFromPoint` — только fallback.
  `autoScrollMatrixWrap` — rAF-throttled.
- **Phase 10 (60%):** animation tokens `--ease-control`, `--ease-layout`,
  `--ease-page`, `--dur-control`, `--dur-layout`, `--dur-page` добавлены в
  `index.css:20-28`. `prefers-reduced-motion` присутствует.
- **Phase 11 (50%):** `PROJECT_DOCUMENTATION.md` и `PERFORMANCE_REFACTOR_PLAN.md`
  существуют (помечены 2026-06-06).

## 2. Симптомы, которые остались (по убыванию боли)

### 2.1 Дублирование матриц (~700 строк копипаста)
- **Где:** `RoomsView.svelte` (793) и `TeachersView.svelte` (764).
- **Корневая причина:** `src/features/matrix/` не создан; общие части
  (`matrixFilter`, `matrixDrag`, `matrixSearchWorker`) вынесены в `lib/`,
  но сами view всё ещё дублируют: `pointerDrag` + `startColumnPointer` +
  `moveColumnPointer` + `finishColumnPointer` + `cleanupPointerDrag`,
  `runMatrixTransition`, `commitColumnDrop`, `commitGroupDrop`,
  `scheduleFallbackSearch`, `getSearchWorker`, tooltip lifecycle
  (`queueTooltip`, `flushTooltip`, `hideTooltip`, `handleTableHover`),
  `groupToneClass`, `groupSlotClasses`, `sheetIdForEntries`,
  `startLessonPress`, `finishLessonPress`, `shortenSubject` vs
  `shortTeacherName`, `formatSubgroup`, `formatTooltipGroup`,
  `formatTooltipGroups`.
- **Чинится в Phase 5.**

### 2.2 «План-факт» открывается > 500 мс
- **Где:** вход в AnalyticsView, особенно для «все курсы».
- **Корневая причина:** `buildPlanFactHierarchy` в `lib/schedule.ts`
  пересчитывается на каждое изменение `today` (60 с тик), `search`,
  `plans`, `lessons` — десятки тысяч итераций для «все курсы».
- **Чинится в Phase 8.**

### 2.3 Подсветка match-колонки всё ещё per-cell
- **Где:** при search-вводе в «Кабинеты» / «Преподаватели».
- **Корневая причина:** `slot-column-match` вешается на каждую ячейку
  (2000+), а не на root через `data-highlight` / `data-dim`.
- **Чинится в Phase 3 (остаток).**

### 2.4 Монолит `lib/schedule.ts` (866 строк) + `lib/utils.ts` (176)
- **Где:** оба файла объединяют несколько доменов: normalize + filters +
  subgroups + planFact + stats в schedule; cn + plural + normalize +
  searchKey + format в utils.
- **Чинится в Phase 9.**

## 3. Известные мелочи (попутно)

| Место | Что | Фаза |
|---|---|---|
| `.brand-mark:hover { transform: rotate(-6deg) scale(1.05) }` | transform в hot path | 3 |
| `Button.svelte:28`, `Card.svelte:19` | `transition` без конкретных свойств + `hover:-translate-y-*` | 10 |
| `AnalyticsView.svelte:60-65` setInterval → `today` | Триггер пересчёта иерархии раз в минуту | 8 (мемоизация) |
| `searchCandidates` в `App.svelte:51-59` | Перерасчёт на каждое нажатие | 4 (мелкое) |
| `public/schedule/**`, `public/index.html` | Мёртвый код | 1 (остаток) |
| `slot-busy.slot-column-match { filter: saturate(1.06) }` | GPU-слой на 2000+ ячеек | 3 (опц.) |
| `tab-view-in` keyframe 110 мс | Микро-animation при tab-switch | 4 (мелкое) |

## 4. Definition of Done

Проект считается починенным, когда выполнены **все** пункты:

### Структура / maintainability
- [ ] Нет дубля `RoomsView` ↔ `TeachersView` (Phase 5).
- [ ] `buildPlanFactHierarchy` мемоизирован (Phase 8).
- [ ] `lib/schedule.ts` и `lib/utils.ts` разделены на доменные модули
      (Phase 9).
- [ ] Нет мёртвого кода в `public/` (Phase 1 остаток).
- [ ] Tooltip агрегатор общий (Phase 6).

### Перформанс
- [ ] Вход в «План-факт» для «все курсы» < 500 мс (Phase 8).
- [ ] Highlight через root `data-highlight` / `data-dim`, не per-cell
      class (Phase 3 остаток).
- [ ] Воркер возвращает `frozen Set` (Phase 2 остаток).
- [ ] `Button` / `Card` без `transform` в hover (Phase 10 остаток).
- [ ] `searchCandidates` мемоизирован (Phase 4 мелкое).
- [ ] `tab-view-in` анимация убрана (Phase 4 мелкое).
- [ ] `will-change` только на `.matrix-drag-preview` (уже сделано).

### Функциональная идентичность
- [ ] Все 4 вкладки работают визуально и функционально как до рефактора.
- [ ] Все фильтры (курс, неделя, группа, подгруппа, тип, search) работают.
- [ ] Tooltip показывает ту же информацию.
- [ ] DnD колонок и групп работает.
- [ ] Сохранение плана работает, optimistic update + rollback.
- [ ] Открытие Google Sheet работает.
- [ ] Тема, refresh, SSE обновления работают.
- [ ] `localStorage` миграции columnOrder/columnGroups/theme не теряются.

### Качество
- [ ] `npm run check && npm run build && npm run lint` зелёные.
- [ ] `PROJECT_DOCUMENTATION.md` отражает post-рефактор состояние.

## 5. Phase 0: Baseline (≈0.5 ч, опционально)

Цифры из v1/v2 в DoD больше не нужны, но **полезно** замерить:

- Время входа в «План-факт» для «все курсы» (baseline для Phase 8).
- Длина общего DOM при переключении вкладок (baseline для Phase 5).
- Время воркера на 5 keystrokes (baseline для Phase 2 остаток).

**Файлы:** `docs/perf-baseline.md` (новый, опционально).

---

## 6. Phase 1 (остаток): добить мёртвый код (≈15 мин)

**Уже сделано:** `Highlight.svelte`, `GlobalFilters.svelte` удалены в
`b79a411`. `WEEKS` уже отсутствовал.

**Работы:**
- Удалить `public/schedule/course_1/`, `public/schedule/course_3/`
  (6 JSON).
- Удалить `public/index.html` — Vite использует корень.
- (Опционально) уточнить `.gitignore` — вынести `preview-server.*.log`,
  `vite-*.log` явно.

**Файлы:** удалить `public/schedule/**`, `public/index.html`;
при необходимости — `.gitignore`.

**Проверка:** `npm run check && npm run build`. Вручную: всё работает.

**Риск:** минимальный.

---

## 7. Phase 2 (остаток): Compact search protocol (≈0.5 дня)

**Уже сделано:** см. §1, ~80 %.

**Что осталось:**

1. **Frozen Set в result.** Сейчас `filterRoomMatrix` / `filterTeacherMatrix`
   возвращают `matches: string[]`; main-thread оборачивает в
   `new Set(result.matches)`. Перейти к `Set<string>` в воркере, шрить
   `frozen` готовый объект.
2. **`matchedSlots: Set<string>`** — для подсветки конкретных ячеек,
   не только колонок (доп. сценарий, когда в комнате только один слот
   матчит). Можно отложить.
3. **(Опционально) `matrixSearchIndex.ts`** — отдельный модуль с
   построением компактного индекса. Сейчас воркер читает
   `source.orderedRooms[i].occupancy[j][k].entries[]` напрямую.

**Файлы:**
- `src/lib/matrixSearchWorker.ts` — изменить протокол result.
- `src/features/rooms/RoomsView.svelte` — упростить
  `applyRoomFilterResult` (не создавать промежуточный `new Set(...)`).
- `src/features/teachers/TeachersView.svelte` — то же.
- (опц.) `src/lib/matrixSearchIndex.ts` (новый).

**Проверка:** search в матрице визуально и функционально тот же;
`npm run check && npm run build`.

**Риск:** низкий.

---

## 8. Phase 3 (остаток): Лёгкая подсветка (≈0.5 дня) ★

**Уже сделано:** см. §1, ~75 %.

**Что осталось:**

1. **Column-level highlight через root data-attr:**
   ```svelte
   <table class="room-matrix" data-highlight={highlightKey} data-dim={dimKey}>
   ```
   ```css
   .room-matrix[data-highlight="col-115"] .col-115 { background: ...; }
   .room-matrix[data-dim="true"] :not(.col-match) { opacity: 0.42; }
   ```
   Один атрибут на корне вместо класса на каждой из 2000+ ячеек.
2. **Multi-column highlight:** если `matchedColumns.size > 1`, использовать
   `data-highlight` как comma-list + селектор `:is(.col-301, .col-302)`.
3. **Убрать `.brand-mark:hover { transform: rotate(-6deg) scale(1.05) }`** —
   заменить на `box-shadow` / `background`.
4. **(Опционально) Убрать `slot-busy.slot-column-match { filter: saturate(1.06) }`**
   — фильтр на 2000+ ячеек добавляет GPU-слой.

**Файлы:** `src/features/rooms/RoomsView.svelte`,
`src/features/teachers/TeachersView.svelte` (data-attr на `<table>`);
`src/index.css` (стили через `[data-highlight="..."]`).

**Проверка:** подсветка при search визуально та же; скролл плавный;
счётчик элементов с `will-change` = 1 (только drag preview).

**Риск:** низкий.

---

## 9. Phase 4 (остаток): Tab state cleanup (≈0.5 ч) ★

**Уже сделано:** см. §1, ~95 %.

**Что осталось:**

1. **Убрать `tab-view-in` keyframe** (110 мс opacity 0.94→1). Это «no-op»
   визуально, но всё равно запускает compositor. Удалить keyframe +
   `animation:` в `.tab-view-active`.
2. **`searchCandidates` мемоизировать** (`App.svelte:51-59`). Сейчас
   пересчитывается на каждый набор search candidates.

**Файлы:** `src/index.css` (убрать `tab-view-in` + keyframe),
`src/App.svelte` (мемоизировать searchCandidates).

**Проверка:** tab-switch < 100 мс видимого отклика;
`npm run check && npm run build`.

**Риск:** минимальный.

---

## 10. Phase 5: Matrix core extraction (≈3-4 дня) ★ ГЛАВНАЯ

**Цель:** убрать ~700 строк дубля между Rooms и Teachers.

**Новая структура (создать):**
```
src/features/matrix/
  matrixTypes.ts            // MatrixKind, MatrixSource, MatrixCellMeta
  matrixColumns.ts          // buildColumnSections, buildColumnSlots
  matrixTooltip.ts          // buildTooltipSummary(entries)
  matrixDnd.ts              // перенести из lib/matrixDrag.ts
  matrixWorkerClient.ts     // перенести из lib/matrixSearchWorker.ts
  matrixFilter.ts           // перенести из lib/matrixFilter.ts
  MatrixView.svelte         // рендер, общий для rooms/teachers
  RoomAdapter.ts            // room categories, room-слот, tooltip с аудиторией
  TeacherAdapter.ts         // vertical header, teacher search key, tooltip с преподавателем
```

**Адаптеры:**
```ts
interface MatrixAdapter<K extends MatrixKind> {
  kind: K
  getColumnSlots(columns: string[]): ColumnSlot[]
  getCellClass(cell: ...): string[]
  getTooltipSummary(entries: ...): TooltipSummary
  formatColumnHeader(column: string): string
}
```

**RoomsView.svelte / TeachersView.svelte** становятся тонкими
(100-200 строк каждый):
```svelte
<MatrixView adapter={roomAdapter} source={roomData} ... />
```

**Файлы:**
- новые: `src/features/matrix/**` (~7 файлов);
- перенести: `src/lib/matrixDrag.ts` → `src/features/matrix/matrixDnd.ts`;
- перенести: `src/lib/matrixSearchWorker.ts`, `src/lib/matrixFilter.ts`
  → `src/features/matrix/`;
- изменить: `src/features/rooms/RoomsView.svelte`,
  `src/features/teachers/TeachersView.svelte` (тонкие обёртки).

**Проверка:** визуально Rooms и Teachers идентичны до/после. DnD, tooltip,
search, фильтры работают в обоих. `npm run check && npm run build`.

**Риск:** средний. Делать на отдельной ветке.

---

## 11. Phase 6 (остаток): Tooltip summary (≈0.5 дня)

**Уже сделано:** `mergeTooltipEntries` агрегирует по
`(subject, teacher/room, type, time, cancelled)` в `RoomsView.svelte:328-354`
и в `TeachersView.svelte:323-344`. Группы компактно:
«3 курс: 301 (1, 2 пг), 302 (3 пг)».

**Что осталось:**

1. Вынести в `src/features/matrix/matrixTooltip.ts`: общий
   `buildTooltipSummary(entries, kind)` с типом-маркером.
2. Rooms/Teachers tooltip — единый шаблон по `blocks`. Сейчас `RoomsView`
   рисует «Кабинет:» + список, `TeachersView` — «Преподаватель:» + список.
   После выноса оба используют общий шаблон.

**Файлы:** новый `src/features/matrix/matrixTooltip.ts`, изменения в
`MatrixView.svelte` (рендер tooltip, после Phase 5).

**Проверка:** tooltip показывает ту же информацию, что и до.
`npm run check && npm run build`.

**Риск:** низкий (зависит от Phase 5).

---

## 12. Phase 7: DnD hit-test cache — ЗАВЕРШЕНО

**Готовность:** 100 %.

**Что сделано** (для справки):
- `lib/matrixDrag.ts:61-98` `createMatrixHitTestCache` собирает `DOMRect`
  для всех `data-matrix-column` и `[data-matrix-group-id]` на старте drag.
- `resolveFromCache` ищет по прямоугольникам с учётом scroll delta.
- `elementFromPoint` — fallback (когда `cache = null`).
- `autoScrollMatrixWrap` — rAF-throttled через
  `queuePointerDrag` / `flushPointerDrag`.

**Дополнительных работ не требуется.**

---

## 13. Phase 8: Analytics index (≈2 дня)

**Готовность:** 0 %.

**Цель:** «План-факт» открывается быстро.

**Работы:**
- Создать `src/features/analytics/analyticsIndex.ts`:
  ```ts
  interface AnalyticsIndex {
    byCourse: Map<number, {
      bySubject: Map<string, {
        groups: Map<groupId, {
          lessons: ScheduleLesson[],
          subgroups: Map<subgroup, ScheduleLesson[]>
        }>
      }>
    }>
  }
  ```
  Построить **один раз** на смену `lessons` (не на `today`).
- `buildPlanFactHierarchy(index, plan, today, search)` — O(subjects ×
  groups × subgroups), без повторной фильтрации уроков.
- Разделить кеши:
  - **Structural plan** (subj/type/group/subgroup сетка) — кеш по
    `(index, plans, search)`.
  - **Done numbers** — кеш по `(index, todayDayStamp)`.
- `today` тикает раз в минуту → `done numbers` пересчитываются,
  `structural plan` — нет.
- `expandAll` / `collapseAll` — то же поведение.
- `inputValue` / `hasChange` / `progressPercent` — оставить (pure,
  не критично).

**Файлы:**
- новый: `src/features/analytics/analyticsIndex.ts`;
- изменить: `src/features/analytics/AnalyticsView.svelte`;
- изменить: `src/lib/schedule.ts` (вынести `buildPlanFactHierarchy` +
  хелперы в `analyticsIndex.ts`).

**Проверка:** цифры planned/scheduled/done совпадают с до-рефактора.
Вход в «План-факт» < 500 мс. `npm run check && npm run build`.

**Риск:** средний (много логики).

---

## 14. Phase 9: lib/schedule.ts + lib/utils.ts split (≈1-2 дня)

**Готовность:** 0 %.

**Цель:** maintainability. Не влияет на пользовательский перформанс
напрямую.

**Работы:**
- `src/lib/schedule/`:
  - `normalize.ts` — `normalizeRoom`, `categorizeRoom`,
    `normalizeTeacherName`.
  - `filterLessons.ts` — `applyLessonFilters`, `matchesSubgroup`,
    `isLessonActiveForWeek`.
  - `subgroups.ts` — `rawSubgroupNumbers`, `parityText`,
    `getActiveSubgroupsForLesson`, `detectParity`.
  - `planFact.ts` — `buildPlanFactHierarchy` + хелперы (после Phase 8).
  - `stats.ts` — `buildStats`, `getPairRange`.
- `src/lib/utils/`:
  - `classes.ts` — `cn`.
  - `searchText.ts` — все normalize/buildKey.
  - `format.ts` — `pluralPair`, `formatUpdatedAt`.
- Удалить/обнулить старые `schedule.ts` и `utils.ts`.
- Проверить мёртвые экспорты: `findRoomLessons`, `findTeacherConflicts`,
  `getBusyPairsForTeacher`, `getTeacherLessonAt`, `getSubgroupsForGroup` —
  если не используются, удалить.

**Файлы:** новые `src/lib/schedule/*`, `src/lib/utils/*`;
удалить/обнулить старые; обновить импорты.

**Проверка:** `npm run check && npm run build && npm run lint`. Прогон
по UI.

**Риск:** средний.

---

## 15. Phase 10 (остаток): Animation polish (≈0.5 дня)

**Уже сделано:** см. §1, ~60 %.

**Что осталось:**

1. **`Button.svelte:28`** — `transition duration-200 ease-spring` +
   `hover:-translate-y-px active:translate-y-0 active:scale-[0.97]`.
   Заменить на точечный
   `transition: background-color, color, border-color, box-shadow`
   (без `transform`).
2. **`Card.svelte:19-21`** — `transition duration-300 ease-spring` +
   `hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-glow`.
   То же — без `transform` в hover.
3. **(Опционально)** Проверить, что `app-header box-shadow` включается
   только при `is-scrolled` (уже так).
4. **(Опционально)** Удалить неиспользуемые keyframes (`shimmer` и т. п.).

**Файлы:** `src/components/ui/Button.svelte`,
`src/components/ui/Card.svelte`.

**Проверка:** визуально кнопки и карточки не прыгают при hover;
transition не триггерит layout.

**Риск:** минимальный.

---

## 16. Phase 11 (остаток): Final QA + docs (≈0.5 дня)

**Уже сделано:** `PROJECT_DOCUMENTATION.md` и
`PERFORMANCE_REFACTOR_PLAN.md` существуют (помечены 2026-06-06).

**Что осталось:**

1. Обновить `PROJECT_DOCUMENTATION.md` — отметить актуальное состояние
   (что из v2 сделано, какие архитектурные решения приняты, что ещё
   осталось из v3).
2. Обновить `PERFORMANCE_REFACTOR_PLAN.md` (v3 → v4) — после выполнения
   Phase 5/8/9 отметить как done.
3. **Финальный QA чеклист:**
   - App load.
   - Все 4 вкладки.
   - Search в Rooms, Teachers, Schedule, Analytics.
   - Все фильтры.
   - Tooltip.
   - DnD reorder + group drop.
   - Plan save optimistic + rollback.
   - Google Sheet open.
   - Theme switch.
   - Refresh.
   - Backend unavailable (через `VITE_API_BASE_URL=""`).
   - `localStorage` миграции columnOrder/columnGroups/theme.

**Файлы:** `PROJECT_DOCUMENTATION.md`, `PERFORMANCE_REFACTOR_PLAN.md`.

**Проверка:** весь чеклист пройден.

**Риск:** нет.

---

## 17. Сводка по оставшемуся объёму

| Фаза | Остаток | Ожидаемый эффект |
|---|---|---|
| 1 | 15 мин, `public/` | чистый бандл |
| 2 | 0.5 дня, frozen Set в воркере | микро-оптимизация, чистота протокола |
| 3 | 0.5 дня, root data-attr | paint fps × 1.3-1.5, чище DOM |
| 4 | 0.5 ч, убрать `tab-view-in` + мемо | микро-оптимизация |
| 5 | **3-4 дня, общий MatrixView** ★ | maintainability, −700 строк |
| 6 | 0.5 дня, общий tooltip (зависит от 5) | компактнее tooltip |
| 8 | **2 дня, AnalyticsIndex** ★ | вход в «План-факт» × 2-3 |
| 9 | **1-2 дня, split lib** | maintainability, чище `lib/` |
| 10 | 0.5 дня, Button/Card transitions | микро-оптимизация |
| 11 | 0.5 дня, QA + docs | релиз |

**Самые «дорогие» по эффекту — фазы 5, 8, 9** (структурные).
Фазы 2-4, 10 — полировка.

**Суммарно оставшийся объём: ~10-12 рабочих дней.**

## 18. Порядок коммитов (≈12)

1. `chore: remove remaining dead code in public/`
2. `perf: search result returns frozen Set from worker`
3. `perf: column-level highlight via root data-attr`
4. `perf: drop tab-view-in, memoise searchCandidates`
5. `refactor: extract shared matrix types and columns`
6. `refactor: move matrixDrag, matrixSearchWorker, matrixFilter into features/matrix/`
7. `refactor: rooms and teachers become thin MatrixView adapters`
8. `feat: shared matrix tooltip summary`
9. `perf: index analytics hierarchy`
10. `refactor: split schedule lib into domain modules`
11. `polish: replace transition-all in Button/Card with specific transitions`
12. `docs: update project docs after final refactor`

## 19. Чего НЕ делать

- Не трогать backend, Apps Script, Vite proxy.
- Не добавлять новые зависимости (no virtual-scroll libs, no
  framer-motion, no animation libs).
- Не делать code-splitting views.
- Не добавлять unit-тесты в этом проходе.
- Не выкатывать мёртвый код обратно.
- Не менять API контракт, формат данных, эндпоинты.
- Не менять пользовательский UI/UX (никаких новых кнопок, иконок,
  layout-перестановок).
- Не трогать ESLint/TS/Tailwind конфиги без крайней необходимости.

## 20. Допустимые визуальные изменения

1. **Phase 3:** колонка highlight теперь через data-attr, не per-cell class
   — визуально то же.
2. **Phase 3:** `.brand-mark:hover` не поворачивается/скейлится, только
   background.
3. **Phase 10:** Button/Card без `transform` в hover — кнопки не
   «приподнимаются», только меняют фон/тень.

**Никакие** другие визуальные изменения не допускаются.
