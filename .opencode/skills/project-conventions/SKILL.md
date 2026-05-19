---
name: project-conventions
description: Coding conventions and patterns specific to the rfict-schedule project
---

## Component Patterns
- Feature views are single files in `src/features/<name>/<Name>View.tsx`
- UI primitives in `src/components/ui/` (kebab-case.tsx)
- All feature views are always mounted; visibility via CSS classes

## State Management
- No global state — all state in App.tsx, passed via props
- useCourseData hook for fetching + caching
- localStorage cache with 60s TTL
- Optimistic plan updates with rollback

## Data Fetching
- fetchJson wrapper with cache busting
- Signal-based cancellation via AbortController
- Response normalization for varying backend shapes

## Import Style
- Path alias `@/` maps to `./src/`
- Named exports only
- No barrel files (index.ts)

## Languages
- Russian for UI labels, English for code identifiers

## Testing & Linting
- ESLint 9 flat config
- TypeScript strict mode
- `npm run lint` to check, `npm run build` to verify
