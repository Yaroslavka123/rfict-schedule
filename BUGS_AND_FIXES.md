# Баги и правки

## Баг 1: Селект недели показывает пустым (не выбранное значение)

### Файл
`src/App.svelte:52–59`, `src/components/layout/TopFilters.svelte:94`

### Причина
`filters.week` инициализируется как `1` (defaultFilters, строка 19). Но в данных семестра неделя 1 может отсутствовать (семестр начинается с недели 7 или позже).

`<select>` с `value={String(filters.week)}` не находит совпадающего `<option>`, браузер оставляет селект без выбора.

Дополнительно, `findCurrentWeek()` (строка 81-104) возвращает `null`, если ни один урок не имеет поля `date`. В этом случае эффект автовыбора не срабатывает, и неделя остаётся `1`.

### Фикс
В `$effect` при загрузке schedule добавить fallback на первую доступную неделю:

```typescript
// App.svelte — заменить существующий $effect (строки 52-59)
$effect(() => {
  if (!schedule) return

  const availableWeeks = Array.from(
    new Set(schedule.weeks.map(w => w.week_number))
  ).sort((a, b) => a - b)

  if (availableWeeks.length > 0 && !availableWeeks.includes(filters.week)) {
    filters = { ...filters, week: availableWeeks[0] }
    return
  }

  const currentWeek = findCurrentWeek(schedule.weeks)
  if (currentWeek && currentWeek !== filters.week) {
    filters = { ...filters, week: currentWeek }
  }
})
```

Условие `!availableWeeks.includes(filters.week)` проверяет, что выбранная неделя реально существует. Если нет — берём первую доступную. `findCurrentWeek` вызывается только если неделя существует.

---

## Баг 2: План-факт — предметы не отображаются для редактирования

### Файл
`src/features/analytics/AnalyticsView.svelte:102–121`

### Причина
Функция `buildSubjectsByCourse()` (строка 102) содержит баг в логике определения курса урока:

```typescript
// Строка 115-116
if (group?.course !== undefined) return group.course === courseNumber
return selectedCourse !== 'all'  // ← БАГ
```

**Случай 1: `selectedCourse = 'all'`**
При просмотре «Всех курсов» и уроке без `lesson.course_number` и без `group.course`:
- `selectedCourse !== 'all'` = `false`
- Урок **исключается** из всех курсов
- `subjectsByCourse[courseNumber]` = пустой массив
- Секция редактирования плана не отображается

**Случай 2: `selectedCourse = 3`**
- `selectedCourse !== 'all'` = `true`
- **Все** уроки без `course_number` попадают в курс 3
- Это может дублировать данные с других курсов

### Фикс
```typescript
function buildSubjectsByCourse(
  sourceCourses: number[],
  sourceLessons: ScheduleLesson[],
  sourceGroups: (ScheduleGroup | ScheduleGroupWithCourse)[],
  selectedCourse: CourseSelection,
) {
  const map: Record<number, string[]> = {}
  const groupsById = new Map(sourceGroups.map(g => [g.id, g]))

  sourceCourses.forEach((courseNumber) => {
    const courseLessons = sourceLessons.filter((lesson) => {
      // Явно указан course_number — используем его
      if (lesson.course_number !== undefined) {
        return lesson.course_number === courseNumber
      }
      // Иначе определяем по группе
      const group = groupsById.get(lesson.group)
      if (group && (group as ScheduleGroupWithCourse).course !== undefined) {
        return (group as ScheduleGroupWithCourse).course === courseNumber
      }
      // Без метаданных — включаем только если выбран конкретный курс
      // и этот курс совпадает с текущим (default behavior)
      return selectedCourse !== 'all' && courseNumber === selectedCourse
    })
    map[courseNumber] = getCourseSubjects(courseLessons)
  })

  return map
}
```

Ключевое изменение: убираем `return selectedCourse !== 'all'` как fallback для **всех** курсов. Теперь уроки без метаданных попадают только в конкретный выбранный курс.

---

## Баг 3: План не сохраняется в бэкенд (PUT не доходит)

### Файл
`src/features/analytics/AnalyticsView.svelte:189–203`
`src/api/scheduleClient.ts:276–283`

### Причина
Ошибка PUT-запроса silently отлавливается и происходит rollback, но пользователю не показывается никакого уведомления. Возможные причины:

1. **CORS** — бэкенд не отдаёт нужные заголовки для `PUT /api/v1/plan`
2. **Формат тела** — бэкенд ожидает другой формат (например, `POST` вместо `PUT`, или обёртку `{ entries: [...] }` вместо flat `{ course, subject, planned_pairs }`)
3. **Поле не передаётся** — `savePlan` проверяет `changed`, но кнопка может быть disabled из-за race condition между `oninput` и проверкой

### Диагностика
Открыть DevTools → Network → отфильтровать `api/v1/plan` → посмотреть запрос и ответ.

- Если запроса нет → проблема в кнопке или `hasPlanChange`
- Если запрос есть, но статус не 2xx → проблема на бэкенде
- Если запрос есть, статус 200, но данные не сохранились → бэкенд не применил upsert

### Фикс (показывать ошибку пользователю)

```typescript
// AnalyticsView.svelte — изменить savePlan
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
    const message = (error as Error).message || 'Неизвестная ошибка'
    alert(`Не удалось сохранить план для «${subject}»\n\n${message}\n\nПроверьте: 1) Доступен ли бэкенд, 2) Корректность данных, 3) Логи сервера.`)
  } finally {
    savingRows = { ...savingRows, [key]: false }
  }
}
```

**Дополнительно:** проверить контракт с бэкендом по `docs/BACKEND_HANDOFF.md`. Если бэкенд ожидает `POST` вместо `PUT` или массив вместо одного объекта — исправить в `scheduleClient.ts`.

```typescript
// scheduleClient.ts — если бэкенд ожидает POST и массив
export async function saveCoursePlanEntry(entry: CoursePlanEntry): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/v1/plan`, {
    method: 'POST',  // или PUT
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify([entry]),  // или { entries: [entry] }
  })
  if (!response.ok) throw new Error(`HTTP ${response.status} — ${response.statusText}`)
}
```

---

## Баг 4: Эффект `findCurrentWeek` запускается при каждой смене курса, даже без данных

### Файл
`src/App.svelte:52–59`

### Причина
Эффект запускается при изменении `schedule` или `filters.course`. Но он содержит guard `if (autoWeekCourse === filters.course) return`, который должен предотвращать повторные запуски.

Проблема: `autoWeekCourse` сбрасывается в `null` только в `setFilters` (строка 68), но эффект выполняется **до** того, как `setFilters` может быть вызван. Если пользователь меняет фильтры напрямую (`filters = { ...filters, week: X }`), `autoWeekCourse` не сбрасывается.

### Фикс
```typescript
let autoWeekCourse = $state<CourseSelection | null>(null)

$effect(() => {
  if (!schedule) return

  // Сброс при смене курса
  if (autoWeekCourse !== filters.course) {
    autoWeekCourse = filters.course
  }

  const availableWeeks = Array.from(
    new Set(schedule.weeks.map(w => w.week_number))
  ).sort((a, b) => a - b)

  if (availableWeeks.length > 0 && !availableWeeks.includes(filters.week)) {
    filters = { ...filters, week: availableWeeks[0] }
    return
  }

  const currentWeek = findCurrentWeek(schedule.weeks)
  if (currentWeek && currentWeek !== filters.week) {
    filters = { ...filters, week: currentWeek }
  }
})
```

Убрать `autoWeekCourse = null` из `setFilters` — эффект сам сбрасывает при смене курса.

---

## Баг 5: `columnGroupsStore` подключён но не используется в матрицах

### Файл
`src/stores/columnGroups.ts` (существует, подключён)
`src/features/rooms/RoomsView.svelte` (не использует)
`src/features/teachers/TeachersView.svelte` (не использует)

### Причина
`columnGroups.ts` имеет готовый API: `reorder()`, `addItem()`, `removeItem()`, `toggleCollapse()`. Дефолтные комнаты жёстко заданы (`['115', '117', '119']` и т.д.) и не соответствуют реальным данным из API.

`RoomsView` и `TeachersView` вычисляют порядок колонок самостоятельно (`orderedRooms` из `buildRoomList`, `orderedTeachers` из `Object.keys(occupancy).sort()`).

### Фикс (отложенный — см. FUTURE.md)
Пока оставить как есть. В будущем (FUTURE.md) подключить `columnGroupsStore` к матрицам для кастомизации порядка и группировки колонок.

Текущий баг: дефолтные списки комнат в `defaultRooms` (`['101', '102', ...]`) могут не совпадать с реальными комнатами из API. Но это не ломает UI — просто комнаты не из списка не попадают в дефолтные группы.

---

## Баг 6: lessonsByRoom и lessonsByTeacher в ScheduleIndex не используются

### Файл
`src/stores/scheduleStore.ts:157–181`

### Причина
`buildScheduleIndex` строит `lessonsByRoom` и `lessonsByTeacher` (строки 172-180), но эти индексы нигде не читаются:

```typescript
// scheduleStore.ts
schedule.lessons.forEach((lesson) => {
  const room = (lesson.room || '').trim()
  if (room) {
    if (!lessonsByRoom[room]) lessonsByRoom[room] = []
    lessonsByRoom[room].push(lesson)  // ← не используется
  }
  const teacher = (lesson.teacher || '').trim()
  if (teacher) {
    if (!lessonsByTeacher[teacher]) lessonsByTeacher[teacher] = []
    lessonsByTeacher[teacher].push(lesson)  // ← не используется
  }
})
```

Это浪费 памяти и CPU на бесполезные структуры.

### Фикс
Удалить неиспользуемые индексы. Заменить на реальные `roomOccupancy` и `teacherOccupancy` (см. OPTIMIZATION_PLAN.md п.1.2).

```typescript
// scheduleStore.ts — удалить из buildScheduleIndex:
lessonsByRoom: {},
lessonsByTeacher: {},

// заменить на:
roomOccupancy: {}
teacherOccupancy: {}
```

---

## Баг 7: inputValue возвращает пустую строку для новых планов

### Файл
`src/features/analytics/AnalyticsView.svelte:176–179`

### Причина
`inputValue()` возвращает `planInputs[key] ?? (planValue(plan, subject) !== undefined ? String(planValue(plan, subject)) : '')`.

Если план для предмета ещё не задан (`planValue` = `undefined`), возвращается `''`. Input placeholder = `'—'`.

Это корректно. Но проблема в том, что **пользователь не видит разницы** между «план не задан» и «план = 0». Если предмету нужно 0 пар, пользователь должен иметь возможность ввести `0`.

```typescript
// Текущая проверка:
const parsed = parseInt(inputValue(courseNumber, subject, plan), 10)
if (Number.isNaN(parsed) || parsed < 0) return
// parsed = 0 → не возвращает (0 >= 0) ✅
```

Проверка пропускает `0`. Но если пользователь стирает поле (становится `''`), то `parseInt('', 10)` = `NaN` → функция выходит, план не удаляется. Это может быть нежелательно.

### Фикс (опционально)
Если нужно разрешить удаление плана (установить в 0 или сбросить):

```typescript
const parsed = parseInt(inputValue(courseNumber, subject, plan), 10)
// Ввод пустой = сброс (удаление записи)
if (inputValue(courseNumber, subject, plan).trim() === '') {
  await onPlanChange({ course: courseNumber, subject, planned_pairs: 0 })
  return
}
if (Number.isNaN(parsed) || parsed < 0) return
```

Текущее поведение (игнорировать пустой ввод) приемлемо для MVP.

---

## Итоговая таблица багов

| # | Баг | Серьёзность | Статус |
|---|-----|-------------|--------|
| 1 | Селект недели пустой | Высокая | Требует фикса |
| 2 | Предметы не отображаются в план-факт | Высокая | Требует фикса |
| 3 | План не сохраняется, нет ошибки | Средняя | Требует фикса + диагностика |
| 4 | findCurrentWeek race condition | Низкая | Требует фикса |
| 5 | columnGroups не подключен | Низкая | Отложено (FUTURE.md) |
| 6 | lessonsByRoom/lessonsByTeacher не используются | Низкая | Уберётся с OPTIMIZATION_PLAN |
| 7 | Пустой input для плана | Низкая | Опционально |

---

## Порядок исправления

```
1 → 2 → 3 → 4 → 6 (автоматически с п.1.2 из OPTIMIZATION_PLAN)
```

1. **Исправить баг недели** (п.1 из списка)
2. **Исправить buildSubjectsByCourse** (п.2)
3. **Добавить alert в savePlan** (п.3)
4. **Исправить autoWeekCourse** (п.4)
5. **Удалить неиспользуемые индексы** (п.6) — автоматически при реализации OPTIMIZATION_PLAN п.1.2