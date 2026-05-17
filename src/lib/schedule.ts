import { DAY_ORDER, LESSON_TYPE_LABELS, PAIRS } from '@/lib/constants'
import { normalizeText } from '@/lib/utils'
import type { FiltersState, LessonType, PlanEntry, PlanFactEntry, ScheduleLesson, WeekSchedule } from '@/types/schedule'

export function getLessonTypeLabel(type: LessonType) {
  return LESSON_TYPE_LABELS[type] || LESSON_TYPE_LABELS.unknown
}

export function getPairRange(lesson: ScheduleLesson) {
  if (lesson.duration <= 1) return String(lesson.pair)
  return `${lesson.pair}-${lesson.pair + lesson.duration - 1}`
}

export function getGoogleSheetUrl(lesson: Pick<ScheduleLesson, 'google_sheet_id'>) {
  if (!lesson.google_sheet_id) return null
  return `https://docs.google.com/spreadsheets/d/${lesson.google_sheet_id}/edit`
}

export function getGroupName(schedule: WeekSchedule, groupId: string) {
  return schedule.groups.find((group) => group.id === groupId)?.name || `Группа ${groupId}`
}

export function applyLessonFilters(schedule: WeekSchedule, filters: FiltersState, search: string) {
  const query = normalizeText(search)
  return schedule.lessons.filter((lesson) => {
    if (filters.group !== 'all' && lesson.group !== filters.group) return false
    if (filters.lessonTypes.length > 0 && !filters.lessonTypes.includes(lesson.type)) return false
    if (!query) return true
    const haystack = [
      lesson.day,
      lesson.date,
      lesson.time,
      lesson.subject,
      lesson.teacher,
      lesson.room,
      lesson.subgroup,
      lesson.frequency,
      lesson.period_start,
      lesson.period_end,
      lesson.comment,
      getGroupName(schedule, lesson.group),
    ]
      .map(normalizeText)
      .join(' ')
    return haystack.includes(query)
  })
}

export function groupLessonsByDay(lessons: ScheduleLesson[]) {
  return DAY_ORDER.map((day) => ({
    day,
    lessons: lessons
      .filter((lesson) => lesson.day === day)
      .sort((a, b) => a.pair - b.pair || a.group.localeCompare(b.group) || a.subject.localeCompare(b.subject)),
  })).filter((group) => group.lessons.length > 0)
}

export function buildStats(lessons: ScheduleLesson[]) {
  return {
    total: lessons.length,
    active: lessons.filter((lesson) => !lesson.cancelled).length,
    lectures: lessons.filter((lesson) => lesson.type === 'lecture').length,
    labs: lessons.filter((lesson) => lesson.type === 'lab').length,
    practices: lessons.filter((lesson) => lesson.type === 'practice').length,
    cancelled: lessons.filter((lesson) => lesson.cancelled).length,
  }
}

export function getRooms(lessons: ScheduleLesson[]) {
  return Array.from(new Set(lessons.map((lesson) => lesson.room).filter((room): room is string => Boolean(room))))
    .sort((a, b) => categorizeRoom(a).order - categorizeRoom(b).order || a.localeCompare(b, 'ru'))
}

export function categorizeRoom(room: string) {
  if (['115', '117', '119'].includes(room)) return { label: 'Лекционный зал', order: 1, tone: 'lecture-hall' as const }
  if (/^к\s*\d+|k\s*\d+/i.test(room) || /к/i.test(room)) return { label: 'Компьютерный класс', order: 2, tone: 'computer' as const }
  return { label: 'Кабинет', order: 3, tone: 'regular' as const }
}

export function findRoomLessons(lessons: ScheduleLesson[], room: string, day: string, pair: number) {
  return lessons.filter((lesson) => {
    const lastPair = lesson.pair + Math.max(lesson.duration, 1) - 1
    return lesson.room === room && lesson.day === day && pair >= lesson.pair && pair <= lastPair
  })
}

export function normalizeTeacherName(name: string | null) {
  return String(name || '').replace(/\s+/g, ' ').trim()
}

export function buildTeacherSummaries(lessons: ScheduleLesson[]) {
  const byTeacher = new Map<string, ScheduleLesson[]>()
  lessons.forEach((lesson) => {
    const teacher = normalizeTeacherName(lesson.teacher)
    if (!teacher) return
    byTeacher.set(teacher, [...(byTeacher.get(teacher) || []), lesson])
  })
  return Array.from(byTeacher.entries())
    .map(([teacher, teacherLessons]) => ({
      teacher,
      lessons: teacherLessons.sort((a, b) => a.day_number - b.day_number || a.pair - b.pair),
      totalPairs: teacherLessons.reduce((sum, lesson) => sum + (lesson.cancelled ? 0 : lesson.duration), 0),
      conflicts: findTeacherConflicts(teacherLessons),
    }))
    .sort((a, b) => a.teacher.localeCompare(b.teacher, 'ru'))
}

export function findTeacherConflicts(lessons: ScheduleLesson[]) {
  const conflicts = new Map<string, ScheduleLesson[]>()
  lessons.forEach((lesson) => {
    for (let pair = lesson.pair; pair <= lesson.pair + lesson.duration - 1; pair += 1) {
      const key = `${lesson.day_number}-${pair}`
      conflicts.set(key, [...(conflicts.get(key) || []), lesson])
    }
  })
  return Array.from(conflicts.values()).filter((group) => group.length > 1)
}

function buildPositionKey(lesson: ScheduleLesson) {
  return [lesson.group, lesson.subgroup || 'all', lesson.subject, lesson.type, normalizeTeacherName(lesson.teacher)].join('|')
}

export function buildPlanFact(schedule: WeekSchedule): PlanFactEntry[] {
  const entries = new Map<string, PlanEntry & { fact_pairs: number }>()
  schedule.lessons.forEach((lesson) => {
    const key = buildPositionKey(lesson)
    const current = entries.get(key)
    const fact = lesson.cancelled ? 0 : lesson.duration
    if (current) {
      current.fact_pairs += fact
      if (!current.google_sheet_id && lesson.google_sheet_id) current.google_sheet_id = lesson.google_sheet_id
      return
    }
    entries.set(key, {
      key,
      course: schedule.course,
      group: lesson.group,
      subgroup: lesson.subgroup,
      subject: lesson.subject,
      type: lesson.type,
      teacher: lesson.teacher,
      google_sheet_id: lesson.google_sheet_id || null,
      planned_pairs: null,
      fact_pairs: fact,
    })
  })

  return Array.from(entries.values())
    .map((entry) => ({
      ...entry,
      remaining_pairs: entry.planned_pairs === null ? null : entry.planned_pairs - entry.fact_pairs,
      status: 'empty-plan' as const,
    }))
    .sort((a, b) => a.subject.localeCompare(b.subject, 'ru') || a.group.localeCompare(b.group, 'ru'))
}

export function buildAnalyticsChart(entries: PlanFactEntry[]) {
  return entries.slice(0, 12).map((entry) => ({
    name: entry.subject.length > 18 ? `${entry.subject.slice(0, 18)}…` : entry.subject,
    fact: entry.fact_pairs,
    plan: entry.planned_pairs || 0,
  }))
}

export function getBusyPairsForTeacher(lessons: ScheduleLesson[]) {
  const busy = new Set<string>()
  lessons.forEach((lesson) => {
    for (let pair = lesson.pair; pair <= lesson.pair + lesson.duration - 1; pair += 1) {
      busy.add(`${lesson.day}-${pair}`)
    }
  })
  return PAIRS.flatMap((pair) => DAY_ORDER.map((day) => ({ day, pair, busy: busy.has(`${day}-${pair}`) })))
}
