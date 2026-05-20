import type {
  CoursePlanEntry,
  CoursePlanMap,
  CourseSchedule,
  MergedSchedule,
  ScheduleGroup,
  ScheduleGroupWithCourse,
  ScheduleLesson,
  WeekSchedule,
} from '@/types/schedule'
import { COURSES } from '@/lib/constants'

export const SUPPORTED_COURSES = COURSES

const DEFAULT_API_BASE_URL = 'https://rfict.up.railway.app'
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || DEFAULT_API_BASE_URL).replace(/\/$/, '')

interface BackendScheduleEnvelope {
  schedule?: WeekSchedule
  weeks?: WeekSchedule[]
  data?: WeekSchedule | WeekSchedule[]
  lessons?: ScheduleLesson[]
  groups?: ScheduleGroup[]
  name?: string
  generated_at?: string
  course?: number
  semester?: number
  week_number?: number
  date_range?: string
}

interface BackendCourseScheduleResponse {
  course?: number
  generated_at?: string
  groups?: ScheduleGroup[]
  weeks?: WeekSchedule[]
  lessons?: ScheduleLesson[]
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    cache: 'no-store',
    ...init,
    headers: { Accept: 'application/json', ...(init?.headers || {}) },
  })
  if (!response.ok) throw new Error(`HTTP ${response.status} ${url}`)
  return response.json() as Promise<T>
}

function bust(url: string) {
  const separator = url.includes('?') ? '&' : '?'
  return `${url}${separator}t=${Date.now()}`
}

/**
 * Drops fields that are null/undefined/empty so we don't carry them through
 * memory / cache. We keep numeric zero, booleans and primitive values.
 */
export function trimLesson(lesson: ScheduleLesson): ScheduleLesson {
  const out: Partial<ScheduleLesson> = {}
  ;(Object.keys(lesson) as (keyof ScheduleLesson)[]).forEach((key) => {
    const value = lesson[key]
    if (value === null || value === undefined) return
    if (typeof value === 'string' && value.trim() === '') return
    ;(out as Record<string, unknown>)[key as string] = value
  })
  if (out.cancelled === undefined) out.cancelled = false
  return out as ScheduleLesson
}

function weekKey(week: WeekSchedule) {
  return week.week_number ?? 0
}

function dedupeWeeks(weeks: WeekSchedule[]): WeekSchedule[] {
  const map = new Map<number, WeekSchedule>()
  weeks.forEach((week) => {
    if (week && Number.isFinite(week.week_number)) map.set(week.week_number, week)
  })
  return Array.from(map.values()).sort((a, b) => weekKey(a) - weekKey(b))
}

function mergeGroups(weeks: WeekSchedule[]): ScheduleGroup[] {
  const map = new Map<string, ScheduleGroup>()
  weeks.forEach((week) => {
    ;(week.groups || []).forEach((group) => {
      if (!map.has(group.id)) map.set(group.id, group)
    })
  })
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, 'ru', { numeric: true }))
}

function flattenLessons(weeks: WeekSchedule[]): ScheduleLesson[] {
  return weeks.flatMap((week) =>
    (week.lessons || []).map((lesson) =>
      trimLesson({ ...lesson, week_number: lesson.week_number ?? week.week_number }),
    ),
  )
}

function normalizeCourseResponse(
  payload: BackendCourseScheduleResponse | BackendScheduleEnvelope | WeekSchedule[],
  course: number,
): WeekSchedule[] {
  if (Array.isArray(payload)) return dedupeWeeks(payload)
  const envelope = payload as BackendCourseScheduleResponse & BackendScheduleEnvelope
  if (Array.isArray(envelope.weeks)) return dedupeWeeks(envelope.weeks)
  if (Array.isArray(envelope.data)) return dedupeWeeks(envelope.data)
  if (envelope.schedule) return [envelope.schedule]
  if (envelope.data && typeof envelope.data === 'object' && !Array.isArray(envelope.data)) {
    return [envelope.data as WeekSchedule]
  }
  if (envelope.lessons && envelope.groups && envelope.week_number !== undefined) {
    return [
      {
        name: envelope.name || `${envelope.week_number}-я неделя`,
        generated_at: envelope.generated_at || new Date().toISOString(),
        course: envelope.course || course,
        semester: envelope.semester || 0,
        week_number: envelope.week_number,
        date_range: envelope.date_range || '',
        groups: envelope.groups,
        lessons: envelope.lessons,
      },
    ]
  }
  return []
}

export async function loadCourseSchedule(
  course: number,
  options?: { signal?: AbortSignal },
): Promise<CourseSchedule> {
  const url = bust(`${API_BASE_URL}/api/v1/schedule?course=${course}`)
  const payload = await fetchJson<BackendCourseScheduleResponse | WeekSchedule[]>(url, {
    signal: options?.signal,
  })
  const weeks = normalizeCourseResponse(payload, course)
  const sorted = dedupeWeeks(weeks)
  return {
    course,
    generated_at: sorted[0]?.generated_at || new Date().toISOString(),
    groups: mergeGroups(sorted),
    weeks: sorted,
    lessons: flattenLessons(sorted),
  }
}

function planKey(subject: string) {
  return subject.trim().toLowerCase()
}

interface BackendPlanResponse {
  plan?: CoursePlanEntry[]
  data?: CoursePlanEntry[]
  entries?: CoursePlanEntry[]
}

function normalizePlanResponse(payload: BackendPlanResponse | CoursePlanEntry[]): CoursePlanEntry[] {
  if (Array.isArray(payload)) return payload
  return payload.plan || payload.data || payload.entries || []
}

function planEntriesToMap(entries: CoursePlanEntry[]): CoursePlanMap {
  const map: CoursePlanMap = {}
  entries.forEach((entry) => {
    if (entry && entry.subject && Number.isFinite(entry.planned_pairs)) {
      map[planKey(entry.subject)] = entry.planned_pairs
    }
  })
  return map
}

export async function loadCoursePlan(
  course: number,
  options?: { signal?: AbortSignal },
): Promise<CoursePlanMap> {
  const url = bust(`${API_BASE_URL}/api/v1/plan?course=${course}`)
  const payload = await fetchJson<BackendPlanResponse | CoursePlanEntry[]>(url, {
    signal: options?.signal,
  })
  return planEntriesToMap(normalizePlanResponse(payload))
}

export interface CourseDataBundle {
  schedule: CourseSchedule
  plan: CoursePlanMap
  fetchedAt: number
}

/**
 * Combined endpoint: parallel fetch of schedule + plan. This removes the
 * sequential network round-trips that previously happened from two separate
 * hooks and keeps `Promise.all` semantics so a failure of either request is
 * propagated together. If a backend `/api/v1/course?course=N` endpoint is
 * added later it can be dropped in here without touching callers.
 */
export async function loadCourseBundle(
  course: number,
  options?: { signal?: AbortSignal },
): Promise<CourseDataBundle> {
  const [schedule, plan] = await Promise.all([
    loadCourseSchedule(course, options),
    loadCoursePlan(course, options).catch(() => ({}) as CoursePlanMap),
  ])
  return { schedule, plan, fetchedAt: Date.now() }
}

export interface AllCoursesBundle {
  schedule: MergedSchedule
  plans: Record<number, CoursePlanMap>
  fetchedAt: number
}

function mergeGroupsWithCourse(parts: { course: number; groups: ScheduleGroup[] }[]): ScheduleGroupWithCourse[] {
  const map = new Map<string, ScheduleGroupWithCourse>()
  parts.forEach(({ course, groups }) => {
    groups.forEach((group) => {
      const key = `${course}::${group.id}`
      if (!map.has(key)) map.set(key, { ...group, course })
    })
  })
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, 'ru', { numeric: true }))
}

export async function loadAllCoursesBundle(
  options?: { signal?: AbortSignal },
): Promise<AllCoursesBundle> {
  const results = await Promise.all(
    SUPPORTED_COURSES.map((course) =>
      loadCourseBundle(course, options).catch(() => null),
    ),
  )

  type ValidEntry = { course: number; bundle: CourseDataBundle }
  const valid: ValidEntry[] = results
    .map<ValidEntry | null>((bundle, index) =>
      bundle ? { course: SUPPORTED_COURSES[index], bundle } : null,
    )
    .filter((entry): entry is ValidEntry => entry !== null)

  if (!valid.length) {
    throw new Error('Не удалось загрузить ни один курс')
  }

  const allWeeks: WeekSchedule[] = []
  const allLessons: ScheduleLesson[] = []
  const groupsPerCourse: { course: number; groups: ScheduleGroup[] }[] = []
  const plans: Record<number, CoursePlanMap> = {}
  const courses: number[] = []

  valid.forEach(({ course, bundle }) => {
    courses.push(course)
    plans[course] = bundle.plan
    groupsPerCourse.push({ course, groups: bundle.schedule.groups })
    bundle.schedule.weeks.forEach((week) => {
      allWeeks.push(week)
    })
    bundle.schedule.lessons.forEach((lesson) => {
      allLessons.push({ ...lesson, course_number: course })
    })
  })

  const merged: MergedSchedule = {
    course: 'all',
    generated_at: new Date().toISOString(),
    groups: mergeGroupsWithCourse(groupsPerCourse),
    weeks: allWeeks,
    lessons: allLessons,
    courses,
  }

  return { schedule: merged, plans, fetchedAt: Date.now() }
}

export async function saveCoursePlanEntry(entry: CoursePlanEntry): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/v1/plan`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(entry),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status} PUT /api/v1/plan`)
}

export { planKey, API_BASE_URL }
