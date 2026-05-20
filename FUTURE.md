# Будущее проекта

## DnD (Drag and Drop)

### Анализ: где DnD имеет смысл

| Место | Взаимодействие | Сложность | Приоритет |
|-------|---------------|-----------|-----------|
| Колонки матрицы комнат | Перетащить заголовок колонки | Низкая | Высокий |
| Колонки матрицы преподавателей | Перетащить заголовок колонки | Низкая | Высокий |
| Группировка комнат/преподавателей | Панель управления группами | Средняя | Средний |
| Перемещение занятий в матрице | Перетащить занятие в другую ячейку | Высокая (бэкенд) | Низкий |

### DnD Уровень 1: Перетаскивание колонок в матрицах

#### Текущее состояние
- Порядок колонок **жёстко задан** в `buildRoomList` (сортировка по категориям → номеру) и `buildTeacherOccupancy` (алфавитная сортировка)
- `columnGroups.ts` уже имеет `reorder()`, но матрицы его не используют

#### План реализации

**Файлы:** `src/stores/columnGroups.ts`, `src/features/rooms/RoomsView.svelte`, `src/features/teachers/TeachersView.svelte`

**1. Подключить columnGroups к матрицам**

Создать `$derived` в RoomsView, который читает порядок из `columnGroupsStore`:

```typescript
// RoomsView.svelte
import { columnGroupsStore } from '@/stores/columnGroups'

// Текущий код:
let roomList = $derived(buildRoomList(weeks, groups, groupFilter, normalizedSearch, lessonTypes))
// Заменить на:
let columnGroups = $derived($columnGroupsStore.rooms)
let orderedRooms = $derived(
  columnGroups.flatMap(group => group.collapsed ? [] : group.items)
)
// Добавить комнаты не из групп
let allRooms = $derived(/* из current data, rooms not in any group */)
let finalRooms = $derived([...orderedRooms, ...allRooms.filter(r => !orderedRooms.includes(r))])
```

**2. Native HTML5 DnD на заголовках колонок**

Без библиотеки — нативный API. Это достаточно для базового перетаскивания:

```svelte
<!-- RoomsView.svelte — в заголовке таблицы -->
<thead>
  <tr>
    <th class="th-day">Д</th>
    <th class="th-pair">П</th>
    {#each finalRooms as room (room)}
      <th
        class="th-room"
        draggable="true"
        data-room={room}
        ondragstart={handleDragStart}
        ondragover={handleDragOver}
        ondrop={handleDrop}
        ondragend={handleDragEnd}
      >
        {room}
      </th>
    {/each}
  </tr>
</thead>
```

```typescript
// RoomsView.svelte
let draggingRoom = $state<string | null>(null)

function handleDragStart(event: DragEvent) {
  const th = event.target as HTMLElement
  draggingRoom = th.dataset.room ?? null
  event.dataTransfer!.effectAllowed = 'move'
}

function handleDragOver(event: DragEvent) {
  event.preventDefault()
  event.dataTransfer!.dropEffect = 'move'
}

function handleDrop(event: DragEvent) {
  event.preventDefault()
  const target = (event.target as HTMLElement).closest('th[data-room]') as HTMLElement | null
  if (!target || !draggingRoom) return

  const targetRoom = target.dataset.room!
  if (targetRoom === draggingRoom) return

  // Определить группу, в которую входит targetRoom
  const groups = $columnGroupsStore.rooms
  for (const group of groups) {
    const fromIdx = group.items.indexOf(draggingRoom)
    const toIdx = group.items.indexOf(targetRoom)
    if (fromIdx !== -1 && toIdx !== -1) {
      columnGroupsStore.reorder('rooms', fromIdx, toIdx)
      return
    }
  }
  // Если комнаты в разных группах — пока nothing (future)
}

function handleDragEnd() {
  draggingRoom = null
}
```

**Эффект:** Пользователь может перетащить заголовок колонки в новое положение → порядок сохраняется в localStorage.

**Ограничения нативного HTML5 DnD:**
- Нет touch-поддержки (мобильные устройства)
- Нет анимаций перетаскивания
- Ограниченные возможности визуальной обратной связи

Если потребуется better UX — добавить `@neodrag/svelte` или `@dnd-kit/svelte`.

---

### DnD Уровень 2: Панель управления группами

#### Концепция
Сайдбар или popover, где пользователь видит:
- Список групп (Поточные, Комп. классы, Кабинеты, пользовательские)
- Внутри каждой группы — список комнат/преподавателей
- Возможность создавать группы, переименовывать, удалять
- Перетаскивать элементы между группами
- Сворачивать/разворачивать группы (уже есть `toggleCollapse`)
- Скрытые группы → скрытые колонки в матрице

#### UI (отдельный компонент)

```svelte
<!-- src/components/ColumnGroupManager.svelte -->
<div class="column-group-panel">
  <h3>Группы</h3>
  {#each $columnGroupsStore.rooms as group (group.id)}
    <div class="group-block">
      <div class="group-header">
        <input value={group.name} onchange={(e) => columnGroupsStore.renameGroup('rooms', group.id, e.currentTarget.value)} />
        <button onclick={() => columnGroupsStore.toggleCollapse('rooms', group.id)}>
          {group.collapsed ? '▸' : '▾'}
        </button>
        {#if !group.isBuiltIn}
          <button onclick={() => columnGroupsStore.removeGroup('rooms', group.id)}>✕</button>
        {/if}
      </div>
      {#if !group.collapsed}
        <div class="group-items" droppable="true" ondragover={handleGroupDragOver} ondrop={(e) => handleGroupDrop(e, group.id)}>
          {#each group.items as item (item)}
            <div draggable="true" ondragstart={(e) => handleItemDragStart(e, item)} class="group-item">
              {item}
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/each}
  <button onclick={() => columnGroupsStore.addGroup('rooms', 'Новая группа')}>
    + Группа
  </button>
</div>
```

**Подключение к матрицам:**
- RoomsView читает `columnGroupsStore.rooms` для порядка и категорий
- TeachersView читает `columnGroupsStore.teachers`
- `group.collapsed` скрывает все колонки группы из матрицы

---

### DnD Уровень 3: Перетаскивание занятий в матрице

**Не рекомендуется для первой реализации.**

Причины:
1. Требует **нового API endpoint** на бэкенде для mutation данных
2. Занятия с `duration > 1` занимают несколько строк — сложная геометрия дропа
3. Данные приходят из Google Sheets — изменение создаст рассинхрон
4. Конфликты (дроп на уже занятую ячейку) требуют UX-решения

**Если понадобится:**
1. Добавить `PUT /api/v1/schedule/move` endpoint на бэкенд
2. Визуализировать пустые слоты как drop-targets
3. Обработать multi-pair duration (занятие занимает несколько строк)
4. Показать confirmation перед перемещением

---

## Другие будущие фичи

### 1. Realtime обновления (SSE)

**Документация:** `docs/BACKEND_HANDOFF.md` секция «Обновления с минимальной задержкой»

**Текущее состояние:** Нет. Polling по кнопке «Обновить».

**План:**
1. Добавить `EventSource` в `scheduleStore.ts`
2. Подписываться на `GET /api/v1/schedule/events?course=N` при загрузке
3. На событие `schedule_updated` → refetch + обновить состояние
4. Fallback на polling каждые 10 секунд если SSE недоступен

```typescript
// scheduleStore.ts
let eventSource: EventSource | null = null

function subscribeToUpdates(course: number) {
  eventSource?.close()
  eventSource = new EventSource(`${API_BASE_URL}/api/v1/schedule/events?course=${course}`)
  eventSource.onmessage = (event) => {
    const data = JSON.parse(event.data)
    if (data.type === 'schedule_updated') {
      void fetch(course)  // refetch
    }
  }
}
```

---

### 2. Batch сохранение планов

**Текущее:** PUT одного объекта за раз. Для 10 предметов = 10 запросов.

**План:** Добавить `PUT /api/v1/plan/batch` на бэкенде.

Frontend:
```typescript
async function saveBatchPlan(entries: CoursePlanEntry[]) {
  const response = await fetch(`${API_BASE_URL}/api/v1/plan/batch`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entries),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
}
```

UI в AnalyticsView: кнопка «Сохранить все» вместо сохранения по одному.

---

### 3. CSV экспорт расписания

**Текущее:** Есть в AnalyticsView (exportCsv).

**Расширить:** Добавить экспорт для ScheduleView и RoomsView.

```typescript
function exportScheduleCsv(lessons: ScheduleLesson[]) {
  const header = ['День', 'Пара', 'Время', 'Предмет', 'Тип', 'Преподаватель', 'Аудитория', 'Группа', 'Подгруппа', 'Отменено']
  const rows = lessons.map(l => [
    l.day, l.pair, l.time, l.subject, l.type, l.teacher || '',
    l.room || '', l.group, l.subgroup || '', l.cancelled ? '✓' : ''
  ])
  // скачать CSV
}
```

---

### 4. Timeline / календарный вид

Альтернативный режим отображения расписания — не таблица по дням, а timeline по неделям.

```svelte
<!-- ScheduleView — режим Timeline -->
<div class="timeline-view">
  {#each weeks as week}
    <div class="week-column">
      <h4>{week.name}</h4>
      <div class="week-grid">
        <!-- каждый день = колонка, каждая пара = строка -->
      </div>
    </div>
  {/each}
</div>
```

---

### 5. Push-уведомления при отменах

Когда Apps Script сохраняет занятие с `cancelled: true`, бэкенд отправляет SSE → frontend показывает toast/banner:

> «⚠️ Занятие отменено: Математика, ИКБО-01-23, Пн 3-я пара, ауд. 115»

---

### 6. Хранение пользовательских настроек

Кроме `columnGroups`, сохранять в localStorage:
- Последний выбранный курс/неделя
- Размер тултипов (compact/full)
- Тёмная/светлая тема (уже есть `themeStore`)
- Предпочитаемые фильтры

```typescript
// src/stores/userPreferences.ts
interface UserPreferences {
  lastCourse: number
  lastWeek: number
  lastTab: AppTab
  tooltipSize: 'compact' | 'full'
  collapsedGroups: Record<ColumnGroupScope, string[]>
}

const STORAGE_KEY = 'rfict-preferences-v1'
```

---

## Приоритеты

| Фича | Приоритет | Сложность | Эффект |
|------|-----------|-----------|--------|
| DnD колонок (уровень 1) | Высокий | Низкая | UX улучшение |
| SSE realtime | Высокий | Средняя | Realtime обновления |
| Batch сохранение планов | Средний | Низкая | Скорость работы |
| Панель групп (уровень 2) | Средний | Средняя | UX улучшение |
| CSV экспорт ScheduleView | Низкий | Низкая | UX улучшение |
| Timeline вид | Низкий | Высокая | Альтернативный режим |
| Push-уведомления | Низкий | Средняя | UX улучшение |
| DnD занятий (уровень 3) | Низкий | Очень высокая | Требует бэкенд |