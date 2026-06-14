# AGENTS.md — Функциональные требования

Все изменения в проекте **обязаны** сохранять нижеперечисленные требования. Нарушение любого из них считается регрессией.

---
qweqweqweqwe
## 1. Навигация и вкладки

- Четыре вкладки: **Расписание**, **Аудитории**, **Преподаватели**, **Аналитика**.
- Переключение вкладки сохраняет состояние фильтров.
- Анимация перехода между вкладками не должна пропадать.
- Header остаётся sticky при прокрутке.

## 2. Фильтры

- Курс, группа, неделя, тип занятия, поиск — общие для всех вкладок.
- Сброс фильтров возвращает UI в начальное состояние.
- Search suggestion (ghost text) работает при вводе.
- Debounce поиска: ~300ms.

## 3. Расписание (ScheduleView)

- Таблица занятий выбранной недели, сгруппированная по дням.
- Каждая строка: предмет, преподаватель, аудитория, группа, подгруппа, период, комментарии.
- Клик по строке открывает связанную Google Sheet.
- Статистика (summary) по неделе отображается.

## 4. Аудитории (RoomsView)

- Матрица: дни × пары × аудитории.
- Занятые слоты подсвечиваются.
- Tooltip по занятому слоту показывает детали занятия.
- Клик по слоту открывает Google Sheet.
- Drag-and-drop порядка аудиторий и групп аудиторий.
- Фильтрация по группе, типу занятия и поиску.

## 5. Преподаватели (TeachersView)

- Матрица: дни × пары × преподаватели.
- Занятые слоты подсвечиваются.
- Tooltip по занятому слоту показывает детали.
- Клик по слоту открывает Google Sheet.
- Drag-and-drop порядка преподавателей и групп преподавателей.
- Фильтрация по группе, типу занятия и поиску.

## 6. Аналитика (AnalyticsView)

- План-факт по курсам, предметам, группам, типам, подгруппам.
- Столбцы: plan, scheduled, done, remaining, percent.
- Редактирование значений done с сохранением через `PUT /api/v1/plan`.
- Экспорт текущих видимых строк в CSV.
- Иерархия: курс → предмет → группа → тип/подгруппа.

## 7. Тема

- Переключение dark/light.
- Состояние сохраняется в `localStorage` (`rfict-theme`).
- Класс `.dark` на `document.documentElement` синхронизируется.

## 8. Данные

- Загрузка расписания через `GET /api/v1/schedule?course=N`.
- Загрузка план-факта через `GET /api/v1/plan?course=N`.
- Сохранение план-факта через `PUT /api/v1/plan`.
- SSE подписка на `/api/v1/sse/schedule` для обновлений.
- Кеш в `localStorage` для офлайн-доступа.
- Курсы: 1, 2, 3, 4.

## 9. Google Sheets интеграция

- Все ссылки на Google Sheet открываются в именованном окне `rfict-sheet-{id}`.
- URL формируется по шаблону из `src/lib/googleSheets.ts`.

## 10. Производительность (не нарушать!)

- **Нет** `transition-all` на `.slot-busy`, `.slot-free`, `.dense-table td`.
- **Нет** `will-change` на `.matrix-drag-preview`.
- `content-visibility: auto` на строки матриц и таблицы.
- Worker не должен возвращать новые объекты occupancy при каждом поиске.
- Hover/throttle обрабатываются через `requestAnimationFrame`.
- CSS hot path: без shadows, mask, backdrop-filter на частых элементах.
- `z-index` sticky ячеек ≤ 1 (не 24).

## 11. API контракты

- Формат ответов backend не меняется.
- Поля `ScheduleLesson`, `CoursePlanEntry`, `WeekSchedule`, `CourseSchedule`, `MergedSchedule` — стабильны.
- Новые endpoints добавляются через `scheduleClient.ts`.

## 12. Типы данных

- `LessonType`: `lecture`, `lab`, `practice`, `seminar`, `curator_hour`, `additional`, `unknown`.
- `SubgroupParity`: `even`, `odd`.
- `FiltersState`: все текущие поля сохраняются.

## 13. Apps Script

- Backend URL по умолчанию: `https://rfict.up.railway.app`.
- Endpoint schedule: `/api/v1/schedule`.
- Push schedule update работает.
- Autosave с delayed export.

## 14. Сборка

- `npm run build` должен проходить без ошибок.
- `npm run lint` не должен иметь ошибок.
- `npm run check` не должен иметь ошибок TypeScript.

## 15. Известные баги (не ломать, чинить!)

### B-1: Ghost text в поиске не отображается

**Причина:** CSS z-index конфликт. Ghost div на `z-10` скрыт за input на `z-20` с opaque background при `filter-field-active`.

**Фикс:** в `src/index.css` строка ~475: `.filter-search-ghost` з-индекс `z-10` → `z-25`.

**Не трогать:** `pointer-events-none` на ghost уже стоит, input кликабелен.

### B-2: Тултипы не показывают чётность недели

**Причина:** поле `frequency` не пробрасывается в `RoomSlotEntry`/`TeacherSlotEntry`.

**Фикс:** добавить `frequency: string | null` в entry, пробросить через `MatrixTooltipInput` → `MatrixTooltipGroup`, отобразить в `formatTooltipGroup()`.

**Файлы:** `scheduleStore.ts`, `matrixTooltip.ts`, `RoomAdapter.ts`, `TeacherAdapter.ts`.

### B-3: ScheduleView показывает пары не той чётности

**Причина:** `applyLessonFilters` в `filterLessons.ts` не вызывает `isLessonActiveForWeek`.

**Фикс:** добавить `if (!isLessonActiveForWeek(lesson, filters.week)) return false` в `applyLessonFilters`.
