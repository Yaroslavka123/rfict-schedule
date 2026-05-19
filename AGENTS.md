# rfict-schedule — Architecture & Conventions

## Core Rule
**Before modifying any file, first read this document to understand the project architecture, then read the relevant files.**

**When you need to search documentation for libraries or APIs used in this project, use the context7 MCP tools automatically.**

## Tech Stack
- **Frontend:** React 19, TypeScript 5.7, Vite 6, Tailwind CSS 3
- **Backend:** Go API on Railway (https://rfict.up.railway.app)
- **Data source:** Google Sheets → Apps Script → Backend API → React UI
- **Package manager:** npm
- **Linting:** ESLint 9 (flat config)

## Project Structure
```
src/
  api/scheduleClient.ts      — HTTP client to backend
  components/
    layout/AppShell.tsx       — Main shell: header, tab nav, theme toggle
    layout/GlobalFilters.tsx  — Sidebar filters: course, group, week, type, search
    ui/button.tsx, card.tsx, input.tsx, badge.tsx  — Reusable UI primitives
  features/
    schedule/ScheduleView.tsx — Day-by-day schedule table
    rooms/RoomsView.tsx       — Room occupancy matrix (day x pair x room)
    teachers/TeachersView.tsx — Teacher occupancy matrix (day x pair x teacher)
    analytics/AnalyticsView.tsx — Plan-fact analytics with editable plan input
  hooks/
    useSchedule.ts            — useCourseData(course, refreshKey) — fetch + cache + optimistic plan
    useTheme.ts               — Dark/light theme toggle
    useDebouncedValue.ts      — Generic debounce hook
  lib/
    constants.ts              — LESSON_TYPE_LABELS, DAY_ORDER, PAIRS, COURSES, etc.
    utils.ts                  — cn(), pluralPair(), formatUpdatedAt(), normalizeText()
    schedule.ts               — All business logic: filtering, stats, analytics builders
  types/schedule.ts           — ScheduleLesson, WeekSchedule, FiltersState, CoursePlanMap, etc.
  index.css                   — Tailwind directives + custom component classes + CSS vars (HSL)
```

## Naming Conventions
| Entity | Convention | Examples |
|---|---|---|
| React components | PascalCase, named export | `function ScheduleView()` |
| Hook files | `usePascalCase.ts` | `useSchedule.ts` |
| Lib/utils | kebab-case.ts | `schedule.ts`, `utils.ts` |
| API files | camelCase.ts | `scheduleClient.ts` |
| UI primitives | kebab-case.tsx in `ui/` | `button.tsx`, `card.tsx` |
| Feature views | PascalCase.tsx in `features/<name>/` | `ScheduleView.tsx` |
| Types | PascalCase | `ScheduleLesson`, `FiltersState` |
| Constants | UPPER_SNAKE_CASE | `DAY_ORDER`, `CACHE_TTL_MS` |
| Functions | camelCase | `buildStats()`, `applyLessonFilters()` |
| CSS classes | kebab-case with BEM prefixes | `filter-chip`, `slot-busy`, `type-lecture` |
| Directory names | kebab-case (plural for docs/root, singular features) | `features/schedule/` |
| Imports | `@/` alias for `./src/` | `import { cn } from '@/lib/utils'` |

## Code Patterns

### State Management
- No global state library — pure React hooks (`useState`, `useEffect`, `useMemo`, `useCallback`)
- All app state lives in `App.tsx` (activeTab, filters, refreshKey), passed via props
- Data is passed down, not lifted up unnecessarily

### Data Fetching (scheduleClient.ts)
- `fetchJson<T>(url, options?)` wrapper with `cache: 'no-store'`
- Timestamp-based cache busting via `bust(url)`
- Response normalization: `normalizeCourseResponse`, `normalizePlanResponse`
- Parallel fetches via `Promise.all` in `loadCourseBundle`
- All functions accept optional `{ signal?: AbortSignal }` for cancellation

### Caching (useSchedule.ts)
- localStorage cache with versioned keys (`rfict-cache-v2-course-{N}`)
- 60-second TTL
- Stale-while-revalidate: show cached data, background refetch if TTL expired
- Optimistic plan updates: mutate cache before network, rollback on failure

### CSS & Styling
- Tailwind CSS v3 with `darkMode: ['class']`
- CSS variables in HSL format for light/dark themes (`--background: 210 40% 98%`)
- Custom component classes in `@layer components` in `index.css`
- `cn()` utility (clsx + tailwind-merge) for conditional class merging
- Dark mode via `.dark` class toggle (useTheme hook)
- No CSS-in-JS, no CSS modules — all custom CSS in `index.css`

### UI Components
- Thin styled wrappers around native HTML elements
- Variant-driven: `variant` prop on Button, `tone` prop on Badge
- Accept `className` via spread for Tailwind customization

### Business Logic
- All data transformation in pure functions in `src/lib/schedule.ts` (~580 lines)
- No React/JSX in lib files — pure TypeScript
- Functions are pure and testable

### Analytics
- Hierarchical plan-fact comparison: course → subject → group → subgroup
- Edit plan via `PUT /api/v1/plan`
- Optimistic updates with rollback

## Data Flow
```
Google Sheets → Apps Script (parse + debounce 2min)
  → POST /api/v1/schedule (webhook)
  → Backend API (single source of truth)
  → GET /api/v1/schedule?course=N (frontend fetches)
  → React UI displays
```

## Filters Available (GlobalFilters)
- Search (subject/teacher free-text)
- Course (1-4) and group
- Subgroup filter
- Week number (1-18)
- Lesson type chips (lecture, lab, practice, seminar, curator_hour, additional)
- Reset button

## Backend Endpoints
```
GET  /api/v1/schedule?course=&week=&group=&day=&type=&teacher=&subject=
GET  /api/v1/groups?course=&department=
GET  /api/v1/weeks?course=
GET  /api/v1/schedule/current?group=
GET  /api/v1/plan?course=
PUT  /api/v1/plan
POST /api/v1/webhook/schedule
```

## Architecture Rules
1. Frontend fetches ONLY from backend API — no GitHub raw, no local JSON fixtures
2. If API is unreachable → show error, no silent fallback
3. All feature views are always mounted; visibility controlled by CSS classes (`tab-panel-active`/`tab-panel-hidden`)
4. Single route (`/`); no routing library — tab switching only
5. Russian language for all user-facing UI
6. Strict TypeScript (`strict: true, noUnusedLocals: true`)
