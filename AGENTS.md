# rfict-schedule — Architecture & Conventions

## Core Rule
**Before modifying any file, first read this document to understand the project architecture, then read the relevant files.**

**Also read:**
- `ROADMAP.md` — current development plan and bug list
- `PROJECT_DOCS.md` — detailed file-by-file documentation
- `docs/BACKEND_HANDOFF.md` — backend API specification
- `docs/FRONTEND_GUIDE.md` — frontend setup guide

**When you need to search documentation for libraries or APIs used in this project, use the context7 MCP tools automatically.**

## Tech Stack
- **Frontend:** Svelte 5, TypeScript 5.7, Vite 6, Tailwind CSS 3
- **Backend:** Go API on Railway (https://rfict.up.railway.app)
- **Data source:** Google Sheets → Apps Script → Backend API → Svelte UI
- **Package manager:** npm
- **Linting:** ESLint 9 (flat config)

## Project Structure
```
src/
  api/scheduleClient.ts      — HTTP client to backend
  components/
    layout/AppShell.svelte       — Main shell: header, tab nav, theme toggle
    layout/TopFilters.svelte     — Horizontal filters (course, group, week, type, search)
    layout/GlobalFilters.svelte  — Sidebar filters (not actively used, replaced by TopFilters)
    ui/Button.svelte, Card.svelte, Input.svelte, Highlight.svelte  — Reusable UI primitives
  features/
    schedule/ScheduleView.svelte — Day-by-day schedule table
    rooms/RoomsView.svelte       — Room occupancy matrix (day x pair x room)
    teachers/TeachersView.svelte — Teacher occupancy matrix (day x pair x teacher)
    analytics/AnalyticsView.svelte — Plan-fact analytics with editable plan input
  stores/
    scheduleStore.ts            — fetch + cache + optimistic plan (with pre-computed indices)
    themeStore.ts               — Dark/light theme toggle
    columnGroups.ts             — Column grouping state for matrices (exists but NOT connected)
  lib/
    constants.ts              — LESSON_TYPE_LABELS, DAY_ORDER, PAIRS, COURSES, etc.
    utils.ts                  — cn(), pluralPair(), formatUpdatedAt(), normalizeText()
    schedule.ts               — All business logic: filtering, stats, analytics builders (~655 lines)
  types/schedule.ts           — ScheduleLesson, WeekSchedule, FiltersState, CoursePlanMap, etc.
  index.css                   — Tailwind directives + custom component classes + CSS vars (HSL)
```

## Naming Conventions
| Entity | Convention | Examples |
|---|---|---|
| Svelte components | PascalCase.svelte, default export | `ScheduleView.svelte` |
| Store files | camelCase.ts | `scheduleStore.ts` |
| Lib/utils | kebab-case.ts | `schedule.ts`, `utils.ts` |
| API files | camelCase.ts | `scheduleClient.ts` |
| UI primitives | PascalCase.svelte in `ui/` | `Button.svelte`, `Card.svelte` |
| Feature views | PascalCase.svelte in `features/<name>/` | `ScheduleView.svelte` |
| Types | PascalCase | `ScheduleLesson`, `FiltersState` |
| Constants | UPPER_SNAKE_CASE | `DAY_ORDER`, `CACHE_TTL_MS` |
| Functions | camelCase | `buildStats()`, `applyLessonFilters()` |
| CSS classes | kebab-case with BEM prefixes | `filter-chip`, `slot-busy`, `type-lecture` |
| Directory names | kebab-case (plural for docs/root, singular features) | `features/schedule/` |
| Imports | `@/` alias for `./src/` | `import { cn } from '@/lib/utils'` |

## Known Issues (see ROADMAP.md for details)
| # | Issue | File | Priority |
|---|-------|------|----------|
| B1 | `<select>` doesn't show selected value | TopFilters.svelte | Medium |
| B2 | Week select empty when week 1 missing | App.svelte, TopFilters.svelte | High |
| B3 | Plan-fact: subjects not displayed for 'all courses' | AnalyticsView.svelte | High |
| B4 | Plan save fails silently | AnalyticsView.svelte + scheduleClient.ts | Medium |
| B5 | Duplicate triggers with 2+ users | Code.gs | Medium |

## Code Patterns

### State Management
- Svelte stores for shared state (`scheduleStore`, `themeStore`, `columnGroups`)
- App-level UI state lives in `App.svelte` (`activeTab`, filters, debounced search)
- Data is passed down, not lifted up unnecessarily

### Data Fetching (scheduleClient.ts)
- `fetchJson<T>(url, options?)` wrapper with `cache: 'no-store'`
- Timestamp-based cache busting via `bust(url)`
- Response normalization: `normalizeCourseResponse`, `normalizePlanResponse`
- Parallel fetches via `Promise.all` in `loadCourseBundle`
- All functions accept optional `{ signal?: AbortSignal }` for cancellation

### Caching (scheduleStore.ts)
- localStorage cache with versioned keys (`rfict-cache-v3-course-{N}`)
- 15-minute TTL
- Stale-while-revalidate: show cached data, background refetch if TTL expired
- Pre-computed `ScheduleIndex` with room/teacher occupancy matrices (built once on fetch)
- Optimistic plan updates: mutate cache before network, rollback on failure

### CSS & Styling
- Tailwind CSS v3 with `darkMode: ['class']`
- CSS variables in HSL format for light/dark themes (`--background: 210 24% 98%`)
- Custom component classes in `@layer components` in `index.css`
- `cn()` utility for conditional class joining
- Dark mode via `.dark` class toggle (`themeStore`)
- No CSS-in-JS, no CSS modules — all custom CSS in `index.css`

### UI Components
- Thin styled wrappers around native HTML elements
- Variant-driven: `variant` prop on Button, `tone` prop on Badge
- Accept `className` via spread for Tailwind customization

### Business Logic
- All data transformation in pure functions in `src/lib/schedule.ts` (~655 lines)
- No Svelte markup in lib files — pure TypeScript
- Functions are pure and testable

### Analytics
- Hierarchical plan-fact comparison: course → group → subgroup → subject (via `buildPlanFactHierarchy`)
- Edit plan via `PUT /api/v1/plan` with optimistic updates
- 3 different hierarchy functions exist (`buildCourseAnalytics`, `buildSubjectPlanRows`, `buildPlanFactHierarchy`) — candidate for refactoring

## Data Flow
```
Google Sheets → Apps Script (parse + debounce 2min)
  → POST /api/v1/schedule (webhook)
  → Backend API (single source of truth)
  → GET /api/v1/schedule?course=N (frontend fetches)
  → Svelte UI displays
```

## Filters Available (TopFilters — horizontal bar in header)
- Search (subject/teacher free-text input)
- Course (1-4 + "All courses" select)
- Group (filtered by course, shows course number when 'all')
- Week number (select, hidden on analytics tab)
- Lesson type (select: lecture, lab, practice, seminar, curator_hour, additional)
- Reset button

## Backend Endpoints
```
GET  /api/v1/schedule?course=N       — Full course schedule (all weeks)
GET  /api/v1/plan?course=N           — Course plan entries
GET  /api/v1/subjects               — Subject dictionary
GET  /api/v1/teachers               — Teacher dictionary
GET  /api/v1/rooms                  — Room dictionary
PUT  /api/v1/plan                   — Upsert plan entry { course, subject, planned_pairs }
POST /api/v1/schedule               — Receive schedule from Apps Script
```

## Architecture Rules
1. Frontend fetches ONLY from backend API — no GitHub raw, no local JSON fixtures
2. If API is unreachable → show error, no silent fallback
3. Only the active feature view is mounted; inactive tabs are not kept in DOM
4. Single route (`/`); no routing library — tab switching only
5. Russian language for all user-facing UI
6. Strict TypeScript (`strict: true, noUnusedLocals: true`)
7. Business logic lives in pure functions in `src/lib/schedule.ts` — never in Svelte components
8. Column order in matrices should come from `columnGroupsStore` (not yet connected — see ROADMAP Phase 2)
9. Apps Script (Google Sheets) is the data entry point; changes propagate through backend to frontend
