import { DAY_ORDER, LECTURE_HALLS, LESSON_TYPE_LABELS, PAIRS } from '@/lib/constants'
import { normalizeForTeacherSearch, normalizeText } from '@/lib/utils'
import { planKey } from '@/api/scheduleClient'
import type {
  AnalyticsCell,
  AnalyticsGroup,
  AnalyticsRow,
  AnalyticsSubgroup,
  CoursePlanMap,
  CourseSchedule,
  FiltersState,
  LessonType,
  MergedSchedule,
  ScheduleGroup,
  ScheduleGroupWithCourse,
  ScheduleLesson,
  SubgroupParity,
  SubjectPlanGroup,
  SubjectPlanRow,
  SubjectPlanSubgroup,
  WeekSchedule,
} from '@/types/schedule'

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

export function getGroupNameById(
  groups: (ScheduleGroup | ScheduleGroupWithCourse)[],
  groupId: string,
) {
  return groups.find((group) => group.id === groupId)?.name || `Группа ${groupId}`
}

export function getWeekByNumber(
  course: CourseSchedule | MergedSchedule,
  week: number,
): WeekSchedule | null {
  return course.weeks.find((entry) => entry.week_number === week) || null
}

export function applyLessonFilters(
  lessons: ScheduleLesson[],
  groups: (ScheduleGroup | ScheduleGroupWithCourse)[],
  filters: FiltersState,
  search: string,
) {
  const query = normalizeText(search)
  return lessons.filter((lesson) => {
    if (filters.group !== 'all' && lesson.group !== filters.group) return false
    if (filters.subgroup && filters.subgroup !== 'all') {
      if ((lesson.subgroup || '') !== filters.subgroup) return false
    }
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
      getGroupNameById(groups, lesson.group),
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

export function normalizeRoom(room: string | null | undefined): string {
  if (!room) return ''
  return String(room).replace(/[KkКк](\s*)(\d)/g, 'К$2').trim()
}

export function categorizeRoom(room: string) {
  const normalized = normalizeRoom(room)
  if (LECTURE_HALLS.includes(normalized)) return { label: 'Лекционный зал', order: 1, tone: 'lecture-hall' as const }
  if (/К\s*\d/.test(normalized)) return { label: 'Компьютерный класс', order: 2, tone: 'computer' as const }
  return { label: 'Кабинет', order: 3, tone: 'regular' as const }
}

export function getRooms(lessons: ScheduleLesson[]) {
  const set = new Set<string>()
  lessons.forEach((lesson) => {
    const room = normalizeRoom(lesson.room)
    if (room && room !== 'ДО') set.add(room)
  })
  return Array.from(set).sort((a, b) => {
    const orderA = categorizeRoom(a).order
    const orderB = categorizeRoom(b).order
    if (orderA !== orderB) return orderA - orderB
    const numA = parseInt(a.replace(/\D+/g, ''), 10)
    const numB = parseInt(b.replace(/\D+/g, ''), 10)
    if (!Number.isNaN(numA) && !Number.isNaN(numB)) return numA - numB
    return a.localeCompare(b, 'ru')
  })
}

export function findRoomLessons(lessons: ScheduleLesson[], room: string, day: string, pair: number) {
  return lessons.filter((lesson) => {
    const lastPair = lesson.pair + Math.max(lesson.duration, 1) - 1
    return normalizeRoom(lesson.room) === room && lesson.day === day && pair >= lesson.pair && pair <= lastPair
  })
}

export function normalizeTeacherName(name: string | null) {
  return String(name || '').replace(/\s+/g, ' ').trim()
}

export interface TeacherSummary {
  teacher: string
  lessons: ScheduleLesson[]
  totalPairs: number
  conflicts: ScheduleLesson[][]
  rooms: string[]
  searchKey: string
}

export function buildTeacherSummaries(lessons: ScheduleLesson[]): TeacherSummary[] {
  const byTeacher = new Map<string, ScheduleLesson[]>()
  lessons.forEach((lesson) => {
    const teacher = normalizeTeacherName(lesson.teacher)
    if (!teacher) return
    byTeacher.set(teacher, [...(byTeacher.get(teacher) || []), lesson])
  })
  return Array.from(byTeacher.entries())
    .map(([teacher, teacherLessons]) => {
      const rooms = Array.from(
        new Set(
          teacherLessons
            .map((lesson) => normalizeRoom(lesson.room))
            .filter((room): room is string => Boolean(room)),
        ),
      ).sort((a, b) => a.localeCompare(b, 'ru', { numeric: true }))
      return {
        teacher,
        lessons: teacherLessons.sort((a, b) => a.day_number - b.day_number || a.pair - b.pair),
        totalPairs: teacherLessons.reduce((sum, lesson) => sum + (lesson.cancelled ? 0 : lesson.duration), 0),
        conflicts: findTeacherConflicts(teacherLessons),
        rooms,
        searchKey: normalizeForTeacherSearch(`${teacher} ${rooms.join(' ')}`),
      }
    })
    .sort((a, b) => a.teacher.localeCompare(b.teacher, 'ru'))
}

export function getTeacherLessonAt(lessons: ScheduleLesson[], day: string, pair: number) {
  return lessons.filter((lesson) => {
    if (lesson.day !== day) return false
    const last = lesson.pair + Math.max(lesson.duration, 1) - 1
    return pair >= lesson.pair && pair <= last
  })
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

export function getBusyPairsForTeacher(lessons: ScheduleLesson[]) {
  const busy = new Set<string>()
  lessons.forEach((lesson) => {
    for (let pair = lesson.pair; pair <= lesson.pair + lesson.duration - 1; pair += 1) {
      busy.add(`${lesson.day}-${pair}`)
    }
  })
  return PAIRS.flatMap((pair) => DAY_ORDER.map((day) => ({ day, pair, busy: busy.has(`${day}-${pair}`) })))
}

export function getSubgroupsForGroup(lessons: ScheduleLesson[], groupId: string) {
  const set = new Set<string>()
  lessons.forEach((lesson) => {
    if (lesson.group !== groupId) return
    if (lesson.subgroup) set.add(lesson.subgroup)
  })
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'ru', { numeric: true }))
}

function isLessonBeforeToday(lesson: ScheduleLesson, today: Date): boolean {
  if (!lesson.date) return false
  const parsed = new Date(lesson.date)
  if (Number.isNaN(parsed.getTime())) return false
  return parsed.getTime() <= today.getTime()
}

function pairsFor(lesson: ScheduleLesson) {
  return lesson.cancelled ? 0 : Math.max(lesson.duration, 1)
}

function matchesSubgroup(lessonSubgroup: string | null, target: string | null) {
  if (!target) return true
  if (!lessonSubgroup) return true
  return lessonSubgroup.split(/[\s,/]+/).some((token) => token.trim() === target.trim())
}

export interface AnalyticsOptions {
  course: number
  plan: CoursePlanMap
  today?: Date
  groups: ScheduleGroup[]
  lessons: ScheduleLesson[]
}

export function buildCourseAnalytics({ plan, today = new Date(), groups, lessons }: AnalyticsOptions): AnalyticsGroup[] {
  const subjectSet = new Set<string>()
  lessons.forEach((lesson) => {
    if (lesson.subject) subjectSet.add(lesson.subject)
  })
  const subjects = Array.from(subjectSet).sort((a, b) => a.localeCompare(b, 'ru'))

  const result: AnalyticsGroup[] = []

  groups.forEach((group) => {
    const groupLessons = lessons.filter((lesson) => lesson.group === group.id)
    const subgroups = getSubgroupsForGroup(groupLessons, group.id)
    const subgroupSlots: (string | null)[] = subgroups.length > 0 ? [null, ...subgroups] : [null]

    const subgroupRows: AnalyticsSubgroup[] = subgroupSlots
      .map<AnalyticsSubgroup>((subgroup) => {
        const rows: AnalyticsRow[] = subjects.map((subject) => {
          const subjectLessons = groupLessons.filter((lesson) => {
            if (lesson.subject !== subject) return false
            return matchesSubgroup(lesson.subgroup, subgroup)
          })
          const scheduled = subjectLessons.reduce((sum, lesson) => sum + pairsFor(lesson), 0)
          const done = subjectLessons.reduce((sum, lesson) => sum + (isLessonBeforeToday(lesson, today) ? pairsFor(lesson) : 0), 0)
          const planned = plan[planKey(subject)]
          const cell: AnalyticsCell = {
            planned: typeof planned === 'number' && Number.isFinite(planned) ? planned : null,
            scheduled,
            done,
          }
          return { subject, cell }
        }).filter((row) => row.cell.scheduled > 0 || row.cell.done > 0 || row.cell.planned !== null)
        return { subgroup, rows }
      })
      .filter((entry) => entry.rows.length > 0)

    if (subgroupRows.length === 0) return
    result.push({
      groupId: group.id,
      groupName: group.name,
      department: group.department,
      subgroups: subgroupRows,
    })
  })

  return result
}

function detectParity(weekNumbers: number[]): SubgroupParity {
  if (weekNumbers.length === 0) return 'none'
  let even = 0
  let odd = 0
  weekNumbers.forEach((week) => {
    if (!Number.isFinite(week)) return
    if (week % 2 === 0) even += 1
    else odd += 1
  })
  if (even > 0 && odd === 0) return 'even'
  if (odd > 0 && even === 0) return 'odd'
  return 'mixed'
}

export interface SubjectPlanOptions {
  plan: CoursePlanMap
  today?: Date
  groups: ScheduleGroup[]
  lessons: ScheduleLesson[]
}

export function buildSubjectPlanRows({
  plan,
  today = new Date(),
  groups,
  lessons,
}: SubjectPlanOptions): SubjectPlanRow[] {
  const subjects = getCourseSubjects(lessons)

  return subjects
    .map((subject) => {
      const planned = plan[planKey(subject)]
      const plannedValue =
        typeof planned === 'number' && Number.isFinite(planned) ? planned : null
      let totalScheduled = 0
      let totalDone = 0

      const groupRows: SubjectPlanGroup[] = []

      groups.forEach((group) => {
        const groupLessons = lessons.filter(
          (lesson) => lesson.group === group.id && lesson.subject === subject,
        )
        if (groupLessons.length === 0) return

        const subgroupNames = getSubgroupsForGroup(groupLessons, group.id)
        const slots: (string | null)[] = subgroupNames.length > 0 ? subgroupNames : [null]

        const subgroupCells: SubjectPlanSubgroup[] = slots
          .map<SubjectPlanSubgroup>((subgroupName) => {
            const subgroupLessons = groupLessons.filter((lesson) =>
              matchesSubgroup(lesson.subgroup, subgroupName),
            )
            const scheduled = subgroupLessons.reduce((sum, lesson) => sum + pairsFor(lesson), 0)
            const done = subgroupLessons.reduce(
              (sum, lesson) => sum + (isLessonBeforeToday(lesson, today) ? pairsFor(lesson) : 0),
              0,
            )
            const weekNumbers = subgroupLessons
              .map((lesson) => lesson.week_number)
              .filter((value): value is number => Number.isFinite(value as number))
            totalScheduled += scheduled
            totalDone += done
            return {
              subgroup: subgroupName,
              parity: subgroupName ? detectParity(weekNumbers) : 'none',
              cell: { planned: plannedValue, scheduled, done },
            }
          })
          .filter((entry) => entry.cell.scheduled > 0 || entry.cell.done > 0)

        if (subgroupCells.length === 0) return
        groupRows.push({
          groupId: group.id,
          groupName: group.name,
          department: group.department,
          subgroups: subgroupCells,
        })
      })

      return {
        subject,
        planned: plannedValue,
        totalScheduled,
        totalDone,
        groups: groupRows,
      }
    })
    .filter((row) => row.groups.length > 0 || row.planned !== null)
    .sort((a, b) => a.subject.localeCompare(b.subject, 'ru'))
}

export function getCourseSubjects(lessons: ScheduleLesson[]): string[] {
  const set = new Set<string>()
  lessons.forEach((lesson) => {
    if (lesson.subject) set.add(lesson.subject)
  })
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'ru'))
}

export function statusColor(cell: AnalyticsCell): 'green' | 'orange' | 'red' | 'muted' | 'blue' {
  if (cell.planned === null) return 'muted'
  if (cell.scheduled < cell.planned) return 'red'
  if (cell.scheduled > cell.planned) return 'orange'
  return 'green'
}

export function progress(cell: AnalyticsCell): number {
  if (cell.planned === null || cell.planned <= 0) return 0
  return Math.round((cell.done / cell.planned) * 100)
}

/**
 * Course-first hierarchy used by Plan-Fact view:
 *   Course → Group → Subgroup → Subject
 *
 * Plans are scoped per course (resolved from `plans[course]`), and each
 * subgroup carries its own scheduled/done counters plus chetnost parity.
 */
export interface PlanFactSubject {
  subject: string
  parity: SubgroupParity
  cell: AnalyticsCell
}

export interface PlanFactSubgroup {
  subgroup: string | null
  subjects: PlanFactSubject[]
  totalPlanned: number
  totalScheduled: number
  totalDone: number
}

export interface PlanFactGroup {
  groupId: string
  groupName: string
  department?: string
  subgroups: PlanFactSubgroup[]
  totalPlanned: number
  totalScheduled: number
  totalDone: number
}

export interface PlanFactCourse {
  course: number
  groups: PlanFactGroup[]
  totalPlanned: number
  totalScheduled: number
  totalDone: number
}

export interface BuildPlanFactOptions {
  courses: number[]
  groups: (ScheduleGroup | ScheduleGroupWithCourse)[]
  lessons: ScheduleLesson[]
  plans: Record<number, CoursePlanMap>
  today?: Date
  search?: string
}

function lessonCourse(
  lesson: ScheduleLesson,
  groupsById: Map<string, ScheduleGroupWithCourse>,
  fallback?: number,
): number | undefined {
  if (lesson.course_number !== undefined) return lesson.course_number
  const group = groupsById.get(lesson.group)
  if (group?.course !== undefined) return group.course
  return fallback
}

export function buildPlanFactHierarchy({
  courses,
  groups,
  lessons,
  plans,
  today = new Date(),
  search,
}: BuildPlanFactOptions): PlanFactCourse[] {
  const groupsById = new Map<string, ScheduleGroupWithCourse>()
  groups.forEach((g) => groupsById.set(g.id, g as ScheduleGroupWithCourse))

  const query = search ? normalizeText(search) : ''

  return courses
    .map<PlanFactCourse>((course) => {
      const coursePlan = plans[course] || {}
      const courseGroups = groups.filter((g) => {
        const wc = g as ScheduleGroupWithCourse
        if (wc.course !== undefined) return wc.course === course
        return true
      })

      const groupResults: PlanFactGroup[] = []

      courseGroups.forEach((group) => {
        const groupLessons = lessons.filter(
          (lesson) =>
            lesson.group === group.id &&
            (lessonCourse(lesson, groupsById, course) === course),
        )
        if (groupLessons.length === 0) return

        const subgroupNames = getSubgroupsForGroup(groupLessons, group.id)
        const subgroupKeys: (string | null)[] = subgroupNames.length > 0 ? subgroupNames : [null]

        const subgroupResults: PlanFactSubgroup[] = []

        subgroupKeys.forEach((subgroupName) => {
          const subgroupLessons = groupLessons.filter((lesson) =>
            matchesSubgroup(lesson.subgroup, subgroupName),
          )
          const subjectSet = new Set<string>()
          subgroupLessons.forEach((lesson) => {
            if (lesson.subject) subjectSet.add(lesson.subject)
          })

          const subjects: PlanFactSubject[] = []
          let sgPlanned = 0
          let sgScheduled = 0
          let sgDone = 0

          Array.from(subjectSet)
            .sort((a, b) => a.localeCompare(b, 'ru'))
            .forEach((subject) => {
              const sl = subgroupLessons.filter((lesson) => lesson.subject === subject)
              const scheduled = sl.reduce((sum, l) => sum + pairsFor(l), 0)
              const done = sl.reduce(
                (sum, l) => sum + (isLessonBeforeToday(l, today) ? pairsFor(l) : 0),
                0,
              )
              const planned = coursePlan[planKey(subject)]
              const plannedValue =
                typeof planned === 'number' && Number.isFinite(planned) ? planned : null
              const weekNumbers = sl
                .map((lesson) => lesson.week_number)
                .filter((value): value is number => Number.isFinite(value as number))
              const cell: AnalyticsCell = { planned: plannedValue, scheduled, done }
              const parity = subgroupName ? detectParity(weekNumbers) : 'none'
              if (query) {
                const haystack = normalizeText(
                  `${subject} ${group.name} ${subgroupName || ''} ${course} курс`,
                )
                if (!haystack.includes(query)) return
              }
              subjects.push({ subject, parity, cell })
              if (plannedValue !== null) sgPlanned += plannedValue
              sgScheduled += scheduled
              sgDone += done
            })

          if (subjects.length === 0) return

          subgroupResults.push({
            subgroup: subgroupName,
            subjects,
            totalPlanned: sgPlanned,
            totalScheduled: sgScheduled,
            totalDone: sgDone,
          })
        })

        if (subgroupResults.length === 0) return

        const gPlanned = subgroupResults.reduce((sum, sg) => sum + sg.totalPlanned, 0)
        const gScheduled = subgroupResults.reduce((sum, sg) => sum + sg.totalScheduled, 0)
        const gDone = subgroupResults.reduce((sum, sg) => sum + sg.totalDone, 0)

        groupResults.push({
          groupId: group.id,
          groupName: group.name,
          department: group.department,
          subgroups: subgroupResults,
          totalPlanned: gPlanned,
          totalScheduled: gScheduled,
          totalDone: gDone,
        })
      })

      return {
        course,
        groups: groupResults,
        totalPlanned: groupResults.reduce((sum, g) => sum + g.totalPlanned, 0),
        totalScheduled: groupResults.reduce((sum, g) => sum + g.totalScheduled, 0),
        totalDone: groupResults.reduce((sum, g) => sum + g.totalDone, 0),
      }
    })
    .filter((c) => c.groups.length > 0)
}
