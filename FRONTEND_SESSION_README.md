# Frontend Session README

Короткая справка для новой сессии без контекста проекта.

## Что это

Frontend расписания РФиКТ БГУ на **Svelte 5 + TypeScript + Vite + Tailwind**.

Сейчас активен только **3 курс**. Данные берутся с backend:

```text
https://rfict.up.railway.app/api/v1/schedule?course=3
https://rfict.up.railway.app/api/v1/plan?course=3
```

`/api/v1/schedule` без `course` сейчас возвращает `400`, поэтому фронт грузит `course=3`.

## Быстрый старт

```bash
npm install
npm run dev
npm run lint
npm run build
```

Dev URL:

```text
http://127.0.0.1:5173/
```

## Главная логика

- [src/App.svelte](src/App.svelte) — главный экран, вкладки, фильтры, выбор недели, подключение store.
- [src/stores/scheduleStore.ts](src/stores/scheduleStore.ts) — загрузка расписания/плана, cache, быстрые индексы `weeksByNumber`, `lessonsByWeek`, `lessonsByRoom`, `lessonsByTeacher`.
- [src/api/scheduleClient.ts](src/api/scheduleClient.ts) — HTTP-клиент backend, нормализация ответа `/schedule`, загрузка плана, PUT плана.
- [src/lib/schedule.ts](src/lib/schedule.ts) — вся бизнес-логика: фильтры, кабинеты, преподаватели, план-факт, активные подгруппы, чет/нечет.

## Важная логика чет/нечет

Использовать только helpers из [src/lib/schedule.ts](src/lib/schedule.ts):

- `getActiveSubgroupsForLesson(lesson, weekNumber)` — возвращает реальные подгруппы для недели.
- `isLessonActiveForWeek(lesson, weekNumber)` — скрывает пары, которые не идут на этой неделе.
- `formatActiveSubgroups(lesson)` — строка для UI.

Пример:

```text
1ПГ/2ПГ нечет/чет
```

На нечетной неделе показывать `1`, на четной `2`.

## Вкладки

- [src/features/rooms/RoomsView.svelte](src/features/rooms/RoomsView.svelte) — матрица кабинетов. Таблица растянута на экран, фильтры поверх таблицы. Tooltip показывает активные подгруппы.
- [src/features/teachers/TeachersView.svelte](src/features/teachers/TeachersView.svelte) — матрица преподавателей. Работает по выбранной неделе, скрывает пары не своей четности.
- [src/features/schedule/ScheduleView.svelte](src/features/schedule/ScheduleView.svelte) — обычная таблица расписания по дням.
- [src/features/analytics/AnalyticsView.svelte](src/features/analytics/AnalyticsView.svelte) — план-факт. Чет/нечет не показывается как бейдж; расчеты должны учитывать активные недели подгрупп.

## Layout и UI

- [src/components/layout/AppShell.svelte](src/components/layout/AppShell.svelte) — верхняя панель, табы, refresh, тема.
- [src/components/layout/GlobalFilters.svelte](src/components/layout/GlobalFilters.svelte) — фильтры курса, группы, подгруппы, недели, типа, поиска.
- [src/components/ui/Button.svelte](src/components/ui/Button.svelte) — кнопка.
- [src/components/ui/Card.svelte](src/components/ui/Card.svelte) — карточка.
- [src/components/ui/Input.svelte](src/components/ui/Input.svelte) — input.
- [src/components/ui/Highlight.svelte](src/components/ui/Highlight.svelte) — подсветка текста.

## Stores

- [src/stores/scheduleStore.ts](src/stores/scheduleStore.ts) — главный store данных.
- [src/stores/themeStore.ts](src/stores/themeStore.ts) — dark/light тема.
- [src/stores/columnGroups.ts](src/stores/columnGroups.ts) — заготовка групп колонок для кабинетов/преподавателей.

## Lib и типы

- [src/types/schedule.ts](src/types/schedule.ts) — типы расписания, плана, фильтров, аналитики.
- [src/lib/constants.ts](src/lib/constants.ts) — курсы, пары, дни, подписи типов занятий. Сейчас `ACTIVE_COURSE = 3`.
- [src/lib/utils.ts](src/lib/utils.ts) — `cn`, формат времени обновления, нормализация текста.
- [src/index.css](src/index.css) — Tailwind, CSS variables, матрицы, tooltip, plan-fact стили.
- [src/main.ts](src/main.ts) — mount Svelte-приложения.
- [src/vite-env.d.ts](src/vite-env.d.ts) — Vite typings.

## Конфиги

- [package.json](package.json) — scripts и зависимости.
- [vite.config.ts](vite.config.ts) — Svelte plugin и alias `@ -> src`.
- [tailwind.config.ts](tailwind.config.ts) — Tailwind content должен включать `.svelte`.
- [eslint.config.js](eslint.config.js) — ESLint flat config для TS/Svelte.
- [tsconfig.app.json](tsconfig.app.json) — strict TS, include `.svelte`.
- [svelte.config.js](svelte.config.js) — Svelte preprocess.

## Что не делать

- Не возвращать React.
- Не читать локальные JSON как fallback в runtime.
- Не показывать `чет/нечет` как отдельные бейджи в UI.
- Не считать исходную строку `1ПГ/2ПГ нечет/чет` как две активные подгруппы сразу.

