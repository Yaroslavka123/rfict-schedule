export type LessonType = 'lecture' | 'lab' | 'practice' | 'seminar' | 'curator_hour' | 'additional' | 'unknown'

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
  week_number?: number
  course_number?: number
}

export interface ScheduleGroupWithCourse extends ScheduleGroup {
  course?: number
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

export interface CourseSchedule {
  course: number
  generated_at: string
  groups: ScheduleGroup[]
  weeks: WeekSchedule[]
  lessons: ScheduleLesson[]
}

export interface MergedSchedule {
  course: number | 'all'
  generated_at: string
  groups: ScheduleGroupWithCourse[]
  weeks: WeekSchedule[]
  lessons: ScheduleLesson[]
  courses: number[]
}

export type CourseSelection = number | 'all'

export interface FiltersState {
  course: CourseSelection
  week: number
  group: string
  subgroup: string
  lessonTypes: LessonType[]
  search: string
}

export interface CoursePlanEntry {
  course: number
  subject: string
  lesson_type?: LessonType
  planned_pairs: number
}

export type CoursePlanMap = Record<string, number>

export interface AnalyticsCell {
  planned: number | null
  scheduled: number
  done: number
}

export interface AnalyticsRow {
  subject: string
  cell: AnalyticsCell
}

export interface AnalyticsSubgroup {
  subgroup: string | null
  rows: AnalyticsRow[]
}

export interface AnalyticsGroup {
  groupId: string
  groupName: string
  department?: string
  subgroups: AnalyticsSubgroup[]
}

export type SubgroupParity = 'even' | 'odd' | 'mixed' | 'none'

export interface SubjectPlanSubgroup {
  subgroup: string | null
  parity: SubgroupParity
  cell: AnalyticsCell
}

export interface SubjectPlanGroup {
  groupId: string
  groupName: string
  department?: string
  subgroups: SubjectPlanSubgroup[]
}

export interface SubjectPlanRow {
  subject: string
  planned: number | null
  totalScheduled: number
  totalDone: number
  groups: SubjectPlanGroup[]
}
