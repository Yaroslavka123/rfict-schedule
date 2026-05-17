import type {
  CoursePlanEntry,
  CoursePlanMap,
  CourseSchedule,
  ScheduleGroup,
  ScheduleLesson,
  WeekSchedule,
} from '@/types/schedule'

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
    (week.lessons || []).map((lesson) => ({ ...lesson, week_number: lesson.week_number ?? week.week_number })),
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

export async function loadCourseSchedule(course: number): Promise<CourseSchedule> {
  const url = bust(`${API_BASE_URL}/api/v1/schedule?course=${course}`)
  const payload = await fetchJson<BackendCourseScheduleResponse | WeekSchedule[]>(url)
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

export async function loadCoursePlan(course: number): Promise<CoursePlanMap> {
  const url = bust(`${API_BASE_URL}/api/v1/plan?course=${course}`)
  const payload = await fetchJson<BackendPlanResponse | CoursePlanEntry[]>(url)
  return planEntriesToMap(normalizePlanResponse(payload))
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
