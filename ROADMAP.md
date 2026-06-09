# ROADMAP — Требования и баги

Дата создания: 2026-06-07.
Дата обновления: 2026-06-09.

---

## Баги (критично — сломано сейчас)

### B-1: Ghost text в поиске не отображается

**Симптом:** при вводе текста в поиск серая подсказка-автодополнение не появляется.

**Причина:** CSS z-index конфликт в `src/index.css`:

| Элемент | z-index | Background |
|---------|---------|------------|
| `<Search>` icon | z-30 | none |
| `<input>` (.filter-search) | z-20 | **opaque gradient** при `filter-field-active` |
| `.filter-search-ghost` div | z-10 | transparent |

Ghost всегда ниже input. Когда пользователь печатает, input получает `filter-field-active` → opaque gradient background → ghost полностью скрыт за input.

**Файл:** `src/index.css`, строка ~475.

**Фикс:** поднять `z-index` ghost с `z-10` на `z-25` ( ghost уже имеет `pointer-events-none`, input по-прежнему кликабельен).

---

### B-2: Тултипы в матрицах не показывают информацию о чётности недели

**Симптом:** тултип по занятому слоту показывает только группу и подгруппу (например, "Группа (1 пг)"), но не показывает чет/нечет/чет-нечет.

**Причина:** поле `frequency` (чет/нечет/еженедельно) не пробрасывается в `RoomSlotEntry` и `TeacherSlotEntry`. Оно потребляется при построении индекса для фильтрации, но отбрасывается до того, как попадает в тултип.

**Файлы:**

- `src/stores/scheduleStore.ts` — `RoomSlotEntry`, `TeacherSlotEntry` (нет поля `frequency`)
- `src/features/matrix/matrixTooltip.ts` — `MatrixTooltipInput`, `MatrixTooltipGroup` (нет `frequency`)
- `src/features/matrix/RoomAdapter.ts` — маппинг entries → tooltip input
- `src/features/matrix/TeacherAdapter.ts` — маппинг entries → tooltip input

**Фикс:**

1. Добавить `frequency: string | null` в `RoomSlotEntry` и `TeacherSlotEntry`.
2. Заполнять из `lesson.frequency` при построении индекса (`scheduleStore.ts`, ~строки 564, 594).
3. Пробрасывать через `MatrixTooltipInput` → `MatrixTooltipGroup`.
4. Отображать в `formatTooltipGroup()` — добавить текст чет/нечет после номера подгруппы.

---

### B-3: ScheduleView показывает пары не той чётности

**Симптом:** при выбранной неделе (например, нечётная) в таблице Расписание отображаются пары с `frequency: 'even'`, которые не должны идти на этой неделе.

**Причина:** `applyLessonFilters` в `src/lib/schedule/filterLessons.ts` **не вызывает** `isLessonActiveForWeek` — фильтрует только по group, subgroup, type, search.

В матрицах (Rooms/Teachers) чётность работает правильно, потому что `roomOccupancyByWeek`/`teacherOccupancyByWeek` строятся с учётом `isLessonActiveForWeek`.

**Файл:** `src/lib/schedule/filterLessons.ts`.

**Фикс:** в `applyLessonFilters` добавить проверку:

```ts
if (!isLessonActiveForWeek(lesson, filters.week)) return false
```

---

## Функциональные требования (должны работать всегда)

### FR-1: Недели и чётность

- При выборе недели показываются **только** пары, соответствующие её чётности.
- `frequency: 'even'` → только на чётных неделях (2, 4, 6...).
- `frequency: 'odd'` → только на нечётных неделях (1, 3, 5...).
- `frequency: 'weekly'` или `null` → на всех неделях.
- Подгруппы отображаются с учётом активности на выбранной неделе.
- Автоподбор текущей недели работает при загрузке и смене курса.

### FR-2: Ghost text в поиске

- При вводе 1+ символов в поле поиска отображается серая подсказка (ghost text).
- Подсказка показывает первое совпадение из кандидатов текущей вкладки.
- Нажатие Tab или → заполняет input полным текстом подсказки.
- Ghost text появляется через ~80ms после ввода (debounce).
- Подсказка обновляется при смене вкладки.

### FR-3: Тултипы в матрицах

- Тултип показывает: предмет, преподавателя/аудиторию, группу, подгруппу, тип пары, время.
- Подгруппа отображается как "N пг" (или "1 пг, 2 пг" для совместных).
- Информация о чётности недели видна в тултипе (чет/нечет/еженедельно).

### FR-4: Навигация

- Четыре вкладки: Расписание, Аудитории, Преподаватели, Аналитика.
- Переключение вкладки сохраняет фильтры.
- Header sticky при прокрутке.

### FR-5: Фильтры

- Курс, группа, неделя, тип занятия, поиск — общие для всех вкладок.
- Сброс фильтров возвращает UI в начальное состояние.

### FR-6: Данные

- Расписание: `GET /api/v1/schedule?course=N`.
- План-факт: `GET /api/v1/plan?course=N`, `PUT /api/v1/plan`.
- SSE: `GET /api/v1/sse/schedule`.
- Кеш в `localStorage`.
- Курсы: 1, 2, 3, 4.

### FR-7: Google Sheets

- Клик по строке/ячейке открывает Google Sheet в именованном окне `rfict-sheet-{id}`.

### FR-8: Аналитика

- План-факт по курсам, предметам, группам, типам, подгруппам.
- Редактирование done-значений с сохранением.
- Экспорт в CSV.

### FR-9: Тема

- Dark/light переключение.
- Состояние в `localStorage` (`rfict-theme`).
- Класс `.dark` на `document.documentElement`.

### FR-10: Сборка

- `npm run build` без ошибок.
- `npm run lint` без ошибок.
- `npm run check` без ошибок TypeScript.
