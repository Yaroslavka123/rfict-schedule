import type { ScheduleResult, WeekSchedule } from '@/types/schedule'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') || ''

interface BackendScheduleResponse {
  schedule?: WeekSchedule
  data?: WeekSchedule
  lessons?: WeekSchedule['lessons']
  groups?: WeekSchedule['groups']
  name?: string
  generated_at?: string
  course?: number
  semester?: number
  week_number?: number
  date_range?: string
}

function normalizeBackendResponse(payload: BackendScheduleResponse, course: number, week: number): WeekSchedule {
  if (payload.schedule) return payload.schedule
  if (payload.data) return payload.data
  return {
    name: payload.name || `${week}-я неделя`,
    generated_at: payload.generated_at || new Date().toISOString(),
    course: payload.course || course,
    semester: payload.semester || 0,
    week_number: payload.week_number || week,
    date_range: payload.date_range || '',
    groups: payload.groups || [],
    lessons: payload.lessons || [],
  }
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json() as Promise<T>
}

async function fetchFromBackend(course: number, week: number): Promise<WeekSchedule> {
  const url = `${API_BASE_URL}/api/v1/schedule?course=${course}&week=${week}`
  const payload = await fetchJson<BackendScheduleResponse>(url)
  return normalizeBackendResponse(payload, course, week)
}

async function fetchFromStaticJson(course: number, week: number): Promise<WeekSchedule> {
  return fetchJson<WeekSchedule>(`/schedule/course_${course}/${week}.json`)
}

export async function loadWeekSchedule(course: number, week: number): Promise<ScheduleResult> {
  if (API_BASE_URL) {
    try {
      return { schedule: await fetchFromBackend(course, week), source: 'backend' }
    } catch (error) {
      console.warn('Backend schedule API unavailable, using JSON fallback', error)
    }
  }
  return { schedule: await fetchFromStaticJson(course, week), source: 'json-fallback' }
}
