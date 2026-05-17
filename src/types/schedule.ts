export type LessonType = 'lecture' | 'lab' | 'practice' | 'seminar' | 'curator_hour' | 'additional' | 'unknown'

export type DataSource = 'backend' | 'json-fallback'

export interface ScheduleGroup {
  id: string
  name: string
  specialty?: string
  department?: string
}

export interface ScheduleLesson {
  day: string
  day_number: number
  date: string | null
  pair: number
  duration: number
  time: string
  group: string
  type: LessonType
  subject: string
  teacher: string | null
  room: string | null
  subgroup: string | null
  frequency: string | null
  period_start: string | null
  period_end: string | null
  comment: string | null
  cancelled: boolean
  google_sheet_id?: string | null
}

export interface WeekSchedule {
  name: string
  generated_at: string
  course: number
  semester: number
  week_number: number
  date_range: string
  groups: ScheduleGroup[]
  lessons: ScheduleLesson[]
}

export interface ScheduleResult {
  schedule: WeekSchedule
  source: DataSource
}

export interface FiltersState {
  course: number
  week: number
  group: string
  lessonTypes: LessonType[]
  search: string
}

export interface PlanEntry {
  key: string
  course: number
  group: string
  subgroup: string | null
  subject: string
  type: LessonType
  teacher: string | null
  google_sheet_id: string | null
  planned_pairs: number | null
}

export interface PlanFactEntry extends PlanEntry {
  fact_pairs: number
  remaining_pairs: number | null
  status: 'ok' | 'warning' | 'over' | 'empty-plan'
}
