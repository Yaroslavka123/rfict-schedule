# План оптимизации производительности

## Контекст

Данные с бэкенда небольшие:
- 4 курса × 15 недель ≈ 300–450 уроков на курс
- ~25 комнат, ~40 преподавателей, ~15 групп
- Матрица комнат: 6 дней × 8 пар × 25 комнат ≈ 1,200 ячеек
- Матрица преподавателей: 6 × 8 × 40 ≈ 1,920 ячеек

**Проблема не в объёме данных, а в паттернах вычислений.** Каждое взаимодействие вызывает повторные полные пересчёты. При таких объёмах Фаза 1 должна полностью устранить лаги.

---

## Фаза 1: Критические (убирают лаг полностью)

### 1.1. 🟢 Ленивая загрузка вкладок

**Файл:** `src/App.svelte:142–183`

**Сейчас:**
```svelte
<div class:hidden={activeTab !== 'rooms'}><RoomsView /></div>
<div class:hidden={activeTab !== 'teachers'}><TeachersView /></div>
<div class:hidden={activeTab !== 'analytics'}><AnalyticsView /></div>
<div class:hidden={activeTab !== 'schedule'}><ScheduleView /></div>
```

**Все 4 вкладки постоянно смонтированы** — все `$derived` вычисляются, ~3,100 DOM-ячеек в матрицах существуют, ~1,900 обработчиков mouseenter/mouseleave активны.

**Фикс:**
```svelte
{#if activeTab === 'rooms'}
  <RoomsView />
{:else if activeTab === 'teachers'}
  <TeachersView />
{:else if activeTab === 'analytics'}
  <AnalyticsView />
{:else if activeTab === 'schedule'}
  <ScheduleView />
{/if}
```

**Механизм:** `{#if}` размонтирует компонент при скрытии вкладки. Вместо `display: none` (class:hidden) — полное уничтожение DOM-поддерева. При возврате на вкладку — новый mount, `$derived` вычисляются заново. Но это дешевле, чем 3,100 скрытых элементов.

**Ожидаемый эффект:** Убирает ~70% вычислений при смене вкладки. Скрытая вкладка не потребляет CPU.

---

### 1.2. 🟢 Pre-compute occupancy в store

**Файл:** `src/stores/scheduleStore.ts` ( функция `buildScheduleIndex`)

**Сейчас:** `ScheduleIndex` содержит `lessonsByRoom` и `lessonsByTeacher`, которые **нигде не используются**. `buildOccupancy()` и `buildTeacherOccupancy()` перестраивают матрицы с нуля при каждом `$derived`.

```typescript
// scheduleStore.ts — текущий ScheduleIndex (не используется)
interface ScheduleIndex {
  lessonsByRoom: Record<string, ScheduleLesson[]>     // ❌ не используется
  lessonsByTeacher: Record<string, ScheduleLesson[]>  // ❌ не используется
}
```

**Фикс:** Расширить `ScheduleIndex`, добавить готовые occupancy-матрицы:

```typescript
// scheduleStore.ts
interface ScheduleIndex {
  weeksByNumber: Record<number, WeekSchedule[]>
  lessonsByWeek: Record<number, ScheduleLesson[]>

  // --- НОВОЕ: готовые occupancy-матрицы (строятся один раз) ---
  roomOccupancy: Record<number, RoomOccupancyIndex>
  teacherOccupancy: Record<number, TeacherOccupancyIndex>
  groupNameMap: Map<string, string>
}

interface RoomOccupancyIndex {
  orderedRooms: string[]                    // комнаты в нужном порядке
  categoryByRoom: Record<string, Category>  // 'lecture-hall' | 'computer' | 'regular'
  categoryStart: Record<string, boolean>    // где начинается новая категория
  occupancy: Record<string, Record<string, Record<number, SlotEntryData[]>>>
  // occupancy[room][day][pair] = SlotEntryData[]
}

interface TeacherOccupancyIndex {
  orderedTeachers: string[]
  occupancy: Record<string, Record<string, Record<number, TeacherSlotData[]>>>
}

interface SlotEntryData {
  subject: string
  teacher: string
  group: string
  groupId: string
  course?: number
  type: LessonType
  subgroup: string
  time: string
  pair: number
  cancelled: boolean
  allCancelled: boolean   // pre-computed: все entries cancelled?
  types: LessonType[]     // pre-computed: Set -> Array
  groupSet: string[]      // pre-computed: Set -> Array
}
```

**Где строить:** в `buildScheduleIndex()` (scheduleStore.ts:154-185). Один проход по `schedule.lessons`:

```typescript
function buildScheduleIndex(schedule: CourseSchedule | MergedSchedule | null): ScheduleIndex {
  // ... существующий код для weeksByNumber, lessonsByWeek ...

  const roomOccupancy: Record<number, RoomOccupancyIndex> = {}
  const teacherOccupancy: Record<number, TeacherOccupancyIndex> = {}
  const groupNameMap = new Map<string, string>()

  schedule.groups.forEach(g => groupNameMap.set(g.id, g.name))

  schedule.lessons.forEach(lesson => {
    const week = lesson.week_number || 0
    const room = normalizeRoom(lesson.room)
    const teacher = normalizeTeacherName(lesson.teacher)

    // Группировка по неделям
    if (!roomOccupancy[week]) roomOccupancy[week] = makeEmptyRoomIndex()
    if (!teacherOccupancy[week]) teacherOccupancy[week] = makeEmptyTeacherIndex()

    // Раскладываем по (room, day, pair) для roomOccupancy
    if (room && room !== 'ДО') {
      for (let p = lesson.pair; p < lesson.pair + Math.max(lesson.duration, 1); p++) {
        if (!roomOccupancy[week].occupancy[room]) roomOccupancy[week].occupancy[room] = {}
        if (!roomOccupancy[week].occupancy[room][lesson.day]) roomOccupancy[week].occupancy[room][lesson.day] = {}
        if (!roomOccupancy[week].occupancy[room][lesson.day][p]) roomOccupancy[week].occupancy[room][lesson.day][p] = []

        const entry = buildSlotEntryData(lesson, groupNameMap)
        roomOccupancy[week].occupancy[room][lesson.day][p].push(entry)
      }
      // Собираем уникальные комнаты
      if (!roomOccupancy[week].orderedRooms.includes(room)) roomOccupancy[week].orderedRooms.push(room)
    }

    // Раскладываем по (teacher, day, pair) для teacherOccupancy
    if (teacher) {
      for (let p = lesson.pair; p < lesson.pair + Math.max(lesson.duration, 1); p++) {
        if (!teacherOccupancy[week].occupancy[teacher]) teacherOccupancy[week].occupancy[teacher] = {}
        if (!teacherOccupancy[week].occupancy[teacher][lesson.day]) teacherOccupancy[week].occupancy[teacher][lesson.day] = {}
        if (!teacherOccupancy[week].occupancy[teacher][lesson.day][p]) teacherOccupancy[week].occupancy[teacher][lesson.day][p] = []

        teacherOccupancy[week].occupancy[teacher][lesson.day][p].push(buildTeacherSlotData(lesson))
      }
      if (!teacherOccupancy[week].orderedTeachers.includes(teacher)) teacherOccupancy[week].orderedTeachers.push(teacher)
    }
  })

  // Сортируем комнаты по категориям
  roomOccupancy[week].orderedRooms.sort((a, b) => {
    const catA = categorizeRoom(a)
    const catB = categorizeRoom(b)
    if (catA.order !== catB.order) return catA.order - catB.order
    return parseInt(a.replace(/\D+/g, '')) - parseInt(b.replace(/\D+/g, ''))
  })

  // Заполняем categoryByRoom, categoryStart
  let lastCat = ''
  roomOccupancy[week].orderedRooms.forEach(room => {
    const cat = categorizeRoom(room).tone
    roomOccupancy[week].categoryByRoom[room] = cat
    roomOccupancy[week].categoryStart[room] = cat !== lastCat
    lastCat = cat
  })

  // Сортируем преподавателей
  teacherOccupancy[week].orderedTeachers.sort((a, b) => a.localeCompare(b, 'ru'))

  return { weeksByNumber, lessonsByWeek, roomOccupancy, teacherOccupancy, groupNameMap }
}
```

**Оптимизации внутри прохода:**
- `normalizeRoom()` вызывается 1 раз на урок (кешируется в локальном Map)
- `normalizeTeacherName()` вызывается 1 раз
- `groupNameMap.get()` — O(1) вместо O(G) `find()`
- Pre-computed `allCancelled`, `types`, `groupSet` — убирает `{@const}` из шаблона
- Pre-computed категории комнат — убирает `categorizeRoom()` из шаблона

**Использование в RoomsView:**
```svelte
let matrixData = $derived($scheduleStore.index.roomOccupancy[filters.week])
let orderedRooms = $derived(matrixData?.orderedRooms || [])
let occupancy = $derived(matrixData?.occupancy || {})
let categoryByRoom = $derived(matrixData?.categoryByRoom || {})
let categoryStart = $derived(matrixData?.categoryStart || {})
```

**Использование в TeachersView:**
```svelte
let teacherData = $derived($scheduleStore.index.teacherOccupancy[filters.week])
let orderedTeachers = $derived(teacherData?.orderedTeachers || [])
let teacherOccupancy = $derived(teacherData?.occupancy || {})
```

**Эффект:**
- Смена недели = O(1) lookup вместо полного перестроения `buildOccupancy`
- `normalizeRoom` (regex `/KkКк/g`) вызывается 1 раз на урок вместо N раз при каждом фильтре
- `getGroupNameById` заменён на `groupNameMap.get()` — O(1)
- `{@const}` вычисления убраны из шаблона (уже в `SlotEntryData`)

---

### 1.3. 🟢 Debounce поиска: 80ms → 200ms

**Файл:** `src/App.svelte:48`

**Сейчас:**
```typescript
const timeout = setTimeout(() => { debouncedSearch = search }, 80)
```

При быстром наборе «Математика» (8 символов) за 640ms — 8 срабатываний, каждый запускает `applyLessonFilters` + все дочерние `$derived`.

**Фикс:**
```typescript
const timeout = setTimeout(() => { debouncedSearch = search }, 200)
```

---

### 1.4. 🟢 Исправить каскадные пересчёты filters

**Файл:** `src/App.svelte:35-37`

**Проблема:** `filters` — это новый proxy-объект при любом изменении (`filters = { ...filters, search: 'x' }`). Любой `$derived`, читающий `filters` (даже отдельное поле), запускается заново.

В данном случае `filteredWeekLessons` читает `filters` → при изменении `filters.search` (или любого другого поля) — пересчёт.

Но проблема глубже: передаём `filters` целиком в `applyLessonFilters`, который внутри читает `filters.group`, `filters.subgroup`, `filters.lessonTypes`, `filters.search`. Если любой из них изменился — функция запускается.

**Фикс (вариант A — debouncedFilters):**

```typescript
// App.svelte
let debouncedFilters = $state<FiltersState | null>(null)

$effect(() => {
  // Фильтры меняются мгновенно
  const f = filters
  const timeout = setTimeout(() => {
    debouncedFilters = { ...f, search: filters.search }
  }, 200)
  return () => clearTimeout(timeout)
})

let filteredWeekLessons = $derived(
  schedule && debouncedFilters
    ? applyLessonFilters(selectedWeekLessons, schedule.groups, debouncedFilters, debouncedFilters.search)
    : []
)
```

При этом:
- `filters` меняется → `selectedWeekLessons` берётся из нового week (мгновенно)
- `debouncedFilters` обновляется через 200ms → `applyLessonFilters` запускается
- Промежуточных запусков `applyLessonFilters` при быстром поиске нет

**Фикс (вариант B — только debouncedSearch, текущий):**

Увеличить debounce до 200ms уже решает проблему. Плюс не передавать `filters` целиком:

```typescript
let filteredWeekLessons = $derived(
  schedule
    ? applyLessonFilters(
        selectedWeekLessons,
        schedule.groups,
        { ...filters, search: debouncedSearch },  // единый объект с debounced search
        debouncedSearch
      )
    : []
)
```

Вариант A сложнее, но даёт больше контроля. Вариант B достаточен.

---

## Фаза 2: Существенные (убирают остаточные задержки)

### 2.1. 🟡 Event delegation для тултипов

**Файлы:** `src/features/rooms/RoomsView.svelte:267,315-316`, `src/features/teachers/TeachersView.svelte:133,180-181`

**Сейчас:** `onmouseenter`/`onmouseleave` на каждой занятой ячейке. ~1,900 обработчиков создаются при mount и никогда не удаляются.

**Фикс (RoomsView):**

Убрать обработчики с `<td>`:
```svelte
<!-- было: <td onmouseenter={...} onmouseleave={...} ... -->
<!-- стало: -->
<td data-key={`${room}|${day}|${pair}`} class="slot-cell slot-busy ...">
```

Один обработчик на `<table>`:
```svelte
<table onmouseover={handleTableHover} onmouseleave={hideTooltip}>
```

```typescript
function handleTableHover(event: MouseEvent) {
  const td = (event.target as HTMLElement).closest('td[data-key]') as HTMLTableCellElement | null
  if (!td) { hideTooltip(); return }
  const [room, day, pair] = td.dataset.key!.split('|')
  const entries = occupancy[room]?.[day]?.[parseInt(pair)]
  if (entries?.length) showTooltip(event, entries)
}
```

Убрать `onmouseleave` с `<table>` (строка 267) — оставить только `onmouseover` на table + один `onmouseleave` на table. При выходе мыши за пределы таблицы — скрытие.

**Эффект:** ~1,900 обработчиков → 1 обработчик.

---

### 2.2. 🟡 Кэш normalizeText

**Файл:** `src/lib/utils.ts:45-47`

**Сейчас:**
```typescript
export function normalizeText(value: string | null | undefined): string {
  return String(value || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim()
}
```

Вызывается тысячи раз: на каждый урок × ~10 полей в `applyLessonFilters`, на каждый teacher в `buildTeacherOccupancy`, на каждую ячейку матрицы.

**Фикс:**
```typescript
const normalizeCache = new Map<string, string>()

export function normalizeText(value: string | null | undefined): string {
  const key = String(value || '')
  const cached = normalizeCache.get(key)
  if (cached !== undefined) return cached
  const result = key.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim()
  normalizeCache.set(key, result)
  return result
}
```

**Примечание:** normalizeRoom уже покрыт п.1.2 (кешируется при построении индекса).

---

### 2.3. 🟡 Pre-compute groupMap в ScheduleView

**Файл:** `src/features/schedule/ScheduleView.svelte`

**Сейчас (строка 131):**
```svelte
<td>{getGroupNameById(groups, lesson.group)}</td>
```

`getGroupNameById` — это `groups.find(g => g.id === groupId)?.name`. O(G) на каждую строку.

**Фикс:**
```typescript
let groupNameMap = $derived(new Map(groups.map(g => [g.id, g.name])))
```

```svelte
<td>{groupNameMap.get(lesson.group) ?? lesson.group}</td>
```

---

### 2.4. 🟡 Debounce fetch в store (быстрые переключения курсов)

**Файл:** `src/App.svelte:39-42`, `src/stores/scheduleStore.ts`

**Сейчас:**
```typescript
$effect(() => {
  const course = filters.course
  void scheduleStore.fetch(course)
})
```

При быстром переключении курсов (1→2→3) — три fetch подряд, только последний нужен. AbortController отменяет предыдущие, но создаёт лишнюю нагрузку.

**Фикс:**
```typescript
let fetchTimeout: ReturnType<typeof setTimeout> | null = null

$effect(() => {
  const course = filters.course
  if (fetchTimeout) clearTimeout(fetchTimeout)
  fetchTimeout = setTimeout(() => {
    void scheduleStore.fetch(course)
  }, 100)
})
```

---

## Фаза 3: Улучшения UX

### 3.1. 🟢 Показывать ошибку сохранения плана

**Файл:** `src/features/analytics/AnalyticsView.svelte:189-203`

**Сейчас:** `catch` просто делает rollback — пользователь не видит ошибку.

**Фикс:**
```typescript
async function savePlan(courseNumber: number, subject: string, plan: CoursePlanMap) {
  const key = rowKey(courseNumber, subject)
  const parsed = parseInt(inputValue(courseNumber, subject, plan), 10)
  if (Number.isNaN(parsed) || parsed < 0) return

  savingRows = { ...savingRows, [key]: true }
  try {
    await onPlanChange({ course: courseNumber, subject, planned_pairs: parsed })
    const nextInputs = { ...planInputs }
    delete nextInputs[key]
    planInputs = nextInputs
  } catch (error) {
    const message = (error as Error).message
    alert(`Не удалось сохранить план для «${subject}»: ${message}`)
  } finally {
    savingRows = { ...savingRows, [key]: false }
  }
}
```

---

### 3.2. 🟢 Исправить баг выбора недели

**Файл:** `src/App.svelte:52-59`

`findCurrentWeek` возвращает `null` если уроки не имеют дат → `filters.week = 1` остаётся, но недели 1 нет в списке → селект пустой.

**Фикс (дополнительно к существующему $effect):**
```typescript
$effect(() => {
  if (!schedule) return
  const availableWeeks = Array.from(new Set(schedule.weeks.map(w => w.week_number))).sort((a, b) => a - b)
  if (availableWeeks.length > 0 && !availableWeeks.includes(filters.week)) {
    filters = { ...filters, week: availableWeeks[0] }
  }
  // существующая логика findCurrentWeek
  const currentWeek = findCurrentWeek(schedule.weeks)
  if (currentWeek && currentWeek !== filters.week) {
    filters = { ...filters, week: currentWeek }
  }
})
```

Или вынести в отдельный `$effect`, который запускается только когда `schedule` меняется.

---

### 3.3. 🟢 today реактивный в аналитике

**Файл:** `src/features/analytics/AnalyticsView.svelte:77`

**Сейчас:**
```typescript
const today = new Date()  // зафиксировано при монтировании
```

**Фикс:**
```typescript
let today = $state(new Date())

$effect(() => {
  const interval = setInterval(() => { today = new Date() }, 60_000)
  return () => clearInterval(interval)
})
```

---

## Что не стоит усилий

### ❌ cn() fast path

`cn()` вызывается ~960 раз на рендер матрицы. Оптимизация сэкономит ~1ms. Не приоритет.

### ❌ buildStats в 1 проход

`buildStats` делает 5 проходов по ~100 элементам. 500 итераций — ничтожно. Оставить как есть.

### ❌ Virtual scrolling

При 1,200–1,920 ячейках матрицы виртуальный скроллинг не даёт выигрыша. Сложность не оправдана.

---

## Итоговая таблица приоритетов

| Приоритет | Что | Файл(ы) | Сложность | Время | Эффект |
|-----------|-----|---------|-----------|-------|--------|
| **P0** | Ленивая загрузка (`{#if}`) | App.svelte | Низкая | 15 мин | −70% вычислений |
| **P0** | Pre-compute occupancy в store | scheduleStore.ts | Высокая | 60 мин | Смена недели = O(1) |
| **P0** | Debounce 80→200ms | App.svelte | 5 мин | 5 мин | Нет промежуточных рендеров |
| **P0** | Исправить filters reactivity | App.svelte | Низкая | 20 мин | Нет каскадных пересчётов |
| **P1** | Event delegation тултипов | RoomsView, TeachersView | Средняя | 30 мин | −1,900 обработчиков |
| **P1** | Кэш normalizeText | utils.ts | Низкая | 10 мин | Убирает повторные normalize |
| **P1** | Pre-compute groupMap | ScheduleView | Низкая | 15 мин | O(1) вместо O(G) |
| **P1** | Debounce fetch | App.svelte | Низкая | 15 мин | Нет лишних отмен |
| **P2** | Ошибка сохранения плана | AnalyticsView | Низкая | 10 мин | UX |
| **P2** | Исправить баг недели | App.svelte | Низкая | 10 мин | Багфикс |
| **P2** | today реактивный | AnalyticsView | Низкая | 10 мин | Корректность |

**Общее время: ~3 часа**

При текущих объёмах данных (300–450 уроков) Фаза 1 должна полностью устранить лаги. После реализации — проверить на реальных данных. Если что-то останется — добавить п.2.1 (event delegation).

---

## Порядок реализации

```
Шаг 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9
```

1. **P0: Ленивая загрузка** — быстрый результат
2. **P0: Debounce 80→200ms** — моментальное улучшение
3. **P0: Pre-compute occupancy** — главная оптимизация (один раз на загрузку, O(n) проход)
4. **P0: Filters reactivity** — убирает каскад
5. **P1: groupMap в ScheduleView** — простое улучшение
6. **P1: Кэш normalizeText** — быстрое улучшение
7. **P1: Event delegation** — убирает обработчики
8. **P1: Debounce fetch** — защита от лишних fetch
9. **P2: UX улучшения** — ошибки, баги, today