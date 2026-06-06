import type { AnalyticsCell, LessonType, SubgroupParity } from '@/types/schedule'

export interface PlanFactSubject {
  subject: string
  types: LessonType[]
  groups: PlanFactGroup[]
  totalPlanned: number
  totalScheduled: number
  totalDone: number
}

export interface PlanFactTypeRowExport {
  type: LessonType
  cell: AnalyticsCell
  plannedSource: 'subject' | 'subject-type' | 'group' | 'group-type' | 'subgroup' | 'subgroup-type' | 'none'
}

export interface PlanFactSubgroup {
  subgroup: string | null
  parity: SubgroupParity
  types: PlanFactTypeRowExport[]
  cell: AnalyticsCell
}

export interface PlanFactGroup {
  groupId: string
  groupName: string
  department?: string
  hasSubgroups: boolean
  types: PlanFactTypeRowExport[]
  subgroups: PlanFactSubgroup[]
  totalPlanned: number
  totalScheduled: number
  totalDone: number
}

export interface PlanFactCourse {
  course: number
  subjects: PlanFactSubject[]
  totalPlanned: number
  totalScheduled: number
  totalDone: number
}

export function statusColor(cell: AnalyticsCell): 'green' | 'orange' | 'red' | 'muted' | 'blue' {
  if (cell.planned === null) return 'muted'
  if (cell.scheduled < cell.planned) return 'red'
  if (cell.scheduled > cell.planned) return 'orange'
  return 'green'
}
