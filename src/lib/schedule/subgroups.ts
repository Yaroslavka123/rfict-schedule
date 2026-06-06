import type { ScheduleLesson, SubgroupParity } from '@/types/schedule'

export function rawSubgroupNumbers(raw: string | null | undefined): string[] {
  if (!raw) return []
  return raw
    .split(/[,\s;/]+/)
    .map((part) => part.trim())
    .filter((part) => /^\d+$/.test(part))
}

export function parityText(parity: SubgroupParity) {
  if (parity === 'even') return 'чет'
  if (parity === 'odd') return 'нечет'
  if (parity === 'mixed') return 'чет/нечет'
  return ''
}

export function detectParity(weekNumbers: number[]): SubgroupParity {
  if (weekNumbers.length === 0) return 'none'
  const hasEven = weekNumbers.some((week) => week % 2 === 0)
  const hasOdd = weekNumbers.some((week) => week % 2 !== 0)
  if (hasEven && hasOdd) return 'mixed'
  return hasEven ? 'even' : 'odd'
}

export function getActiveSubgroupsForLesson(
  lesson: Pick<ScheduleLesson, 'subgroup' | 'frequency' | 'week_number'>,
  activeWeek?: number,
) {
  const subgroups = rawSubgroupNumbers(lesson.subgroup)
  if (subgroups.length === 0) return []
  const week = activeWeek ?? lesson.week_number
  if (!week || !lesson.frequency) return subgroups
  if (lesson.frequency === 'weekly') return subgroups
  if (lesson.frequency === 'even' && week % 2 === 0) return subgroups
  if (lesson.frequency === 'odd' && week % 2 !== 0) return subgroups
  return []
}

export function isLessonActiveForWeek(
  lesson: Pick<ScheduleLesson, 'frequency' | 'week_number'>,
  activeWeek?: number,
) {
  const week = activeWeek ?? lesson.week_number
  if (!week || !lesson.frequency || lesson.frequency === 'weekly') return true
  if (lesson.frequency === 'even') return week % 2 === 0
  if (lesson.frequency === 'odd') return week % 2 !== 0
  return true
}

export function formatActiveSubgroups(lesson: Pick<ScheduleLesson, 'subgroup' | 'frequency' | 'week_number'>) {
  const active = getActiveSubgroupsForLesson(lesson)
  if (active.length === 0) return ''
  return active.map((subgroup) => `${subgroup} пг`).join(', ')
}
