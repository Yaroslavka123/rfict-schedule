import type {
  CoursePlanEntry,
  CoursePlanMap,
  CourseSchedule,
  DataSource,
  ScheduleGroup,
  ScheduleLesson,
  WeekSchedule,
} from '@/types/schedule'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') || ''
const GITHUB_REPO = import.meta.env.VITE_GITHUB_REPO || 'Yaroslavka123/rfict-schedule'
const GITHUB_BRANCH = import.meta.env.VITE_GITHUB_BRANCH || 'main'
const GITHUB_RAW_BASE = `https://raw.githubusercontent.com/${GITHUB_REPO}/${GITHUB_BRANCH}/public/schedule`
const MAX_WEEKS = 20

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

function emptyWeek(course: number, week: number): WeekSchedule {
  return {
    name: `${week}-я неделя`,
    generated_at: new Date().toISOString(),
    course,
    semester: 0,
    week_number: week,
    date_range: '',
    groups: [],
    lessons: [],
  }
}

function normalizeCourseResponse(payload: BackendCourseScheduleResponse | BackendScheduleEnvelope | WeekSchedule[], course: number): WeekSchedule[] {
  if (Array.isArray(payload)) return dedupeWeeks(payload)
  const envelope = payload as BackendCourseScheduleResponse & BackendScheduleEnvelope
  if (Array.isArray(envelope.weeks)) return dedupeWeeks(envelope.weeks)
  if (Array.isArray(envelope.data)) return dedupeWeeks(envelope.data)
  if (envelope.schedule) return [envelope.schedule]
  if (envelope.data && typeof envelope.data === 'object' && !Array.isArray(envelope.data)) return [envelope.data as WeekSchedule]
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

async function fetchCourseFromBackend(course: number): Promise<WeekSchedule[]> {
  const url = bust(`${API_BASE_URL}/api/v1/schedule?course=${course}`)
  const payload = await fetchJson<BackendCourseScheduleResponse | WeekSchedule[]>(url)
  return normalizeCourseResponse(payload, course)
}

async function fetchCourseFromGithub(course: number): Promise<WeekSchedule[]> {
  const weeks = Array.from({ length: MAX_WEEKS }, (_, index) => index + 1)
  const results = await Promise.all(
    weeks.map(async (week) => {
      try {
        return await fetchJson<WeekSchedule>(bust(`${GITHUB_RAW_BASE}/course_${course}/${week}.json`))
      } catch {
        return null
      }
    }),
  )
  return dedupeWeeks(results.filter((week): week is WeekSchedule => week !== null))
}

async function fetchCourseFromLocal(course: number): Promise<WeekSchedule[]> {
  const weeks = Array.from({ length: MAX_WEEKS }, (_, index) => index + 1)
  const results = await Promise.all(
    weeks.map(async (week) => {
      try {
        return await fetchJson<WeekSchedule>(bust(`/schedule/course_${course}/${week}.json`))
      } catch {
        return null
      }
    }),
  )
  return dedupeWeeks(results.filter((week): week is WeekSchedule => week !== null))
}

function buildCourseSchedule(course: number, weeks: WeekSchedule[], source: DataSource): CourseSchedule {
  const sorted = dedupeWeeks(weeks)
  return {
    course,
    generated_at: sorted[0]?.generated_at || new Date().toISOString(),
    groups: mergeGroups(sorted),
    weeks: sorted,
    lessons: flattenLessons(sorted),
    source,
  }
}

export async function loadCourseSchedule(course: number): Promise<CourseSchedule> {
  if (API_BASE_URL) {
    try {
      const weeks = await fetchCourseFromBackend(course)
      if (weeks.length > 0) return buildCourseSchedule(course, weeks, 'backend')
    } catch (error) {
      console.warn('[schedule] backend unavailable, trying GitHub raw', error)
    }
  }
  try {
    const weeks = await fetchCourseFromGithub(course)
    if (weeks.length > 0) return buildCourseSchedule(course, weeks, 'github')
  } catch (error) {
    console.warn('[schedule] github raw unavailable, trying local', error)
  }
  const weeks = await fetchCourseFromLocal(course)
  return buildCourseSchedule(course, weeks.length > 0 ? weeks : [emptyWeek(course, 1)], 'local')
}

function planKey(subject: string) {
  return subject.trim().toLowerCase()
}

function localStorageKey(course: number) {
  return `rfict-plan-course-${course}`
}

function readLocalPlan(course: number): CoursePlanMap {
  try {
    const raw = localStorage.getItem(localStorageKey(course))
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, number>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeLocalPlan(course: number, plan: CoursePlanMap) {
  try {
    localStorage.setItem(localStorageKey(course), JSON.stringify(plan))
  } catch (error) {
    console.warn('[plan] cannot save plan to localStorage', error)
  }
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

export async function loadCoursePlan(course: number): Promise<{ plan: CoursePlanMap; source: DataSource }> {
  if (API_BASE_URL) {
    try {
      const url = bust(`${API_BASE_URL}/api/v1/plan?course=${course}`)
      const payload = await fetchJson<BackendPlanResponse | CoursePlanEntry[]>(url)
      const entries = normalizePlanResponse(payload)
      const map = planEntriesToMap(entries)
      writeLocalPlan(course, map)
      return { plan: map, source: 'backend' }
    } catch (error) {
      console.warn('[plan] backend unavailable, using localStorage', error)
    }
  }
  return { plan: readLocalPlan(course), source: 'local' }
}

export async function saveCoursePlanEntry(entry: CoursePlanEntry): Promise<DataSource> {
  if (API_BASE_URL) {
    try {
      await fetch(`${API_BASE_URL}/api/v1/plan`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(entry),
      }).then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
      })
      const map = readLocalPlan(entry.course)
      map[planKey(entry.subject)] = entry.planned_pairs
      writeLocalPlan(entry.course, map)
      return 'backend'
    } catch (error) {
      console.warn('[plan] backend save failed, saving to localStorage', error)
    }
  }
  const map = readLocalPlan(entry.course)
  map[planKey(entry.subject)] = entry.planned_pairs
  writeLocalPlan(entry.course, map)
  return 'local'
}

export { planKey, API_BASE_URL, GITHUB_RAW_BASE }
