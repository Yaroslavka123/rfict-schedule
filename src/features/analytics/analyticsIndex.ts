import { planKey } from '@/api/scheduleClient'
import { getActiveSubgroupsForLesson, getLessonTypeLabel, isLessonActiveForWeek } from '@/lib/schedule'
import { buildSearchKey, normalizeSearchQuery } from '@/lib/utils'
import type {
  PlanFactCourse,
  PlanFactGroup,
  PlanFactSubgroup,
  PlanFactSubject,
  PlanFactTypeRowExport,
} from '@/lib/schedule'
import type {
  AnalyticsCell,
  CoursePlanMap,
  LessonType,
  ScheduleGroup,
  ScheduleGroupWithCourse,
  ScheduleLesson,
  SubgroupParity,
} from '@/types/schedule'

interface SubjectBucket {
  lessons: ScheduleLesson[]
  byGroup: Map<string, ScheduleLesson[]>
}

interface CourseIndex {
  course: number
  groups: (ScheduleGroup | ScheduleGroupWithCourse)[]
  groupsById: Map<string, ScheduleGroup | ScheduleGroupWithCourse>
  subjects: Map<string, SubjectBucket>
}

export interface AnalyticsIndex {
  courses: CourseIndex[]
}

export interface BuildAnalyticsIndexOptions {
  courses: number[]
  groups: (ScheduleGroup | ScheduleGroupWithCourse)[]
  lessons: ScheduleLesson[]
}

export interface BuildIndexedPlanFactOptions {
  index: AnalyticsIndex
  plans: Record<number, CoursePlanMap>
  today?: Date
  search?: string
}

const lessonDayStampCache = new WeakMap<ScheduleLesson, number | null>()

function rawSubgroupNumbers(raw: string | null | undefined): string[] {
  if (!raw) return []
  return raw
    .split(/[,\s;/]+/)
    .map((part) => part.trim())
    .filter((part) => /^\d+$/.test(part))
}

function dateDayStamp(value: Date) {
  return Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate())
}

function lessonDayStamp(lesson: ScheduleLesson): number | null {
  const cached = lessonDayStampCache.get(lesson)
  if (cached !== undefined) return cached
  if (!lesson.date) {
    lessonDayStampCache.set(lesson, null)
    return null
  }
  const date = new Date(lesson.date)
  if (Number.isNaN(date.getTime())) {
    lessonDayStampCache.set(lesson, null)
    return null
  }
  const stamp = dateDayStamp(date)
  lessonDayStampCache.set(lesson, stamp)
  return stamp
}

function isLessonBeforeToday(lesson: ScheduleLesson, todayStamp: number): boolean {
  if (!lesson.date) return false
  const stamp = lessonDayStamp(lesson)
  return stamp !== null && stamp < todayStamp && !lesson.cancelled
}

function pairsFor(lesson: ScheduleLesson) {
  return Math.max(lesson.duration || 1, 1)
}

function detectParity(weekNumbers: number[]): SubgroupParity {
  if (weekNumbers.length === 0) return 'none'
  const hasEven = weekNumbers.some((week) => week % 2 === 0)
  const hasOdd = weekNumbers.some((week) => week % 2 !== 0)
  if (hasEven && hasOdd) return 'mixed'
  return hasEven ? 'even' : 'odd'
}

function lessonCourse(
  lesson: ScheduleLesson,
  groupsById: Map<string, ScheduleGroupWithCourse>,
): number | undefined {
  if (lesson.course_number !== undefined) return lesson.course_number
  const group = groupsById.get(lesson.group)
  return group?.course
}

function lessonSubgroupTargets(lesson: ScheduleLesson): (string | null)[] {
  const activeSubgroups = getActiveSubgroupsForLesson(lesson)
  if (activeSubgroups.length > 0) return activeSubgroups
  if (rawSubgroupNumbers(lesson.subgroup).length > 0) return []
  return isLessonActiveForWeek(lesson) ? [null] : []
}

function matchesPlanFactSubgroup(lesson: ScheduleLesson, subgroup: string | null) {
  return lessonSubgroupTargets(lesson).some((target) => target === subgroup)
}

function planNumber(value: number | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function emptyCell(): AnalyticsCell {
  return { planned: null, scheduled: 0, done: 0 }
}

function addCell(target: AnalyticsCell, source: AnalyticsCell) {
  if (source.planned !== null) target.planned = (target.planned ?? 0) + source.planned
  target.scheduled += source.scheduled
  target.done += source.done
}

function getActiveType(type: LessonType | null | undefined): LessonType {
  if (!type || type === 'unknown') return 'unknown'
  return type
}

function planFactSubgroupSlots(lessons: ScheduleLesson[]): (string | null)[] {
  let hasWholeGroupLessons = false
  const subgroups = new Set<string>()
  lessons.forEach((lesson) => {
    lessonSubgroupTargets(lesson).forEach((target) => {
      if (target === null) hasWholeGroupLessons = true
      else subgroups.add(target)
    })
  })
  return [
    ...(hasWholeGroupLessons ? [null] : []),
    ...Array.from(subgroups).sort((a, b) => a.localeCompare(b, 'ru', { numeric: true })),
  ]
}

function buildPlanFactTypeRow(
  type: LessonType,
  subject: string,
  groupId: string,
  subgroup: string | null,
  plan: CoursePlanMap,
  cell: AnalyticsCell,
): PlanFactTypeRowExport {
  const subjTyped = planNumber(plan[planKey(subject, type)])
  const subjDefault = planNumber(plan[planKey(subject)])
  const grpTyped = planNumber(plan[planKey(subject, type, groupId)])
  const grpDefault = planNumber(plan[planKey(subject, null, groupId)])
  const sgTyped = subgroup ? planNumber(plan[planKey(subject, type, groupId, subgroup)]) : null
  const sgDefault = subgroup ? planNumber(plan[planKey(subject, null, groupId, subgroup)]) : null

  let planned: number | null = null
  let source: PlanFactTypeRowExport['plannedSource'] = 'none'
  if (sgTyped !== null) {
    planned = sgTyped
    source = 'subgroup-type'
  } else if (sgDefault !== null) {
    planned = sgDefault
    source = 'subgroup'
  } else if (grpTyped !== null) {
    planned = grpTyped
    source = 'group-type'
  } else if (grpDefault !== null) {
    planned = grpDefault
    source = 'group'
  } else if (subjTyped !== null) {
    planned = subjTyped
    source = 'subject-type'
  } else if (subjDefault !== null) {
    planned = subjDefault
    source = 'subject'
  }

  return {
    type,
    cell: { planned, scheduled: cell.scheduled, done: cell.done },
    plannedSource: source,
  }
}

function buildPlanFactSubgroupRow(
  subgroup: string | null,
  groupLessons: ScheduleLesson[],
  subject: string,
  groupId: string,
  plan: CoursePlanMap,
  todayStamp: number,
): PlanFactSubgroup | null {
  const typesMap = new Map<LessonType, AnalyticsCell>()
  const weekNumbers: number[] = []

  groupLessons.forEach((lesson) => {
    if (!matchesPlanFactSubgroup(lesson, subgroup)) return
    const type = getActiveType(lesson.type)
    if (!typesMap.has(type)) typesMap.set(type, emptyCell())
    const cell = typesMap.get(type)!
    const pairCount = pairsFor(lesson)
    cell.scheduled += pairCount
    if (isLessonBeforeToday(lesson, todayStamp)) cell.done += pairCount

    if (Number.isFinite(lesson.week_number as number)) {
      weekNumbers.push(lesson.week_number as number)
    }
  })

  if (typesMap.size === 0) return null

  const types: PlanFactTypeRowExport[] = Array.from(typesMap.keys())
    .sort((a, b) => getLessonTypeLabel(a).localeCompare(getLessonTypeLabel(b), 'ru'))
    .map((type) => buildPlanFactTypeRow(type, subject, groupId, subgroup, plan, typesMap.get(type)!))

  const aggregated = emptyCell()
  types.forEach((row) => addCell(aggregated, row.cell))

  return {
    subgroup,
    parity: subgroup ? detectParity(weekNumbers) : 'none',
    types,
    cell: aggregated,
  }
}

function ensureSubjectBucket(courseIndex: CourseIndex, lesson: ScheduleLesson) {
  if (!lesson.subject) return
  let bucket = courseIndex.subjects.get(lesson.subject)
  if (!bucket) {
    bucket = { lessons: [], byGroup: new Map() }
    courseIndex.subjects.set(lesson.subject, bucket)
  }
  bucket.lessons.push(lesson)
  if (!bucket.byGroup.has(lesson.group)) bucket.byGroup.set(lesson.group, [])
  bucket.byGroup.get(lesson.group)!.push(lesson)
}

export function buildAnalyticsIndex({ courses, groups, lessons }: BuildAnalyticsIndexOptions): AnalyticsIndex {
  const allGroupsById = new Map<string, ScheduleGroupWithCourse>()
  groups.forEach((group) => allGroupsById.set(group.id, group as ScheduleGroupWithCourse))

  const courseIndexes = courses.map((course): CourseIndex => {
    const courseGroups = groups.filter((group) => {
      const withCourse = group as ScheduleGroupWithCourse
      if (withCourse.course !== undefined) return withCourse.course === course
      return true
    })
    return {
      course,
      groups: courseGroups,
      groupsById: new Map(courseGroups.map((group) => [group.id, group])),
      subjects: new Map(),
    }
  })
  const byCourse = new Map(courseIndexes.map((item) => [item.course, item]))

  lessons.forEach((lesson) => {
    const resolvedCourse = lessonCourse(lesson, allGroupsById)
    if (resolvedCourse === undefined) {
      courseIndexes.forEach((courseIndex) => ensureSubjectBucket(courseIndex, lesson))
      return
    }
    const courseIndex = byCourse.get(resolvedCourse)
    if (courseIndex) ensureSubjectBucket(courseIndex, lesson)
  })

  return { courses: courseIndexes }
}

export function buildPlanFactHierarchy({
  index,
  plans,
  today = new Date(),
  search,
}: BuildIndexedPlanFactOptions): PlanFactCourse[] {
  const query = search ? normalizeSearchQuery(search) : ''
  const todayStamp = dateDayStamp(today)

  return index.courses
    .map<PlanFactCourse>((courseIndex) => {
      const coursePlan = plans[courseIndex.course] || {}
      const subjectResults: PlanFactSubject[] = []

      Array.from(courseIndex.subjects.entries())
        .sort(([a], [b]) => a.localeCompare(b, 'ru'))
        .forEach(([subject, subjectBucket]) => {
          const subjectLessons = subjectBucket.lessons
          const types = Array.from(new Set(subjectLessons.map((lesson) => getActiveType(lesson.type))))
            .sort((a, b) => getLessonTypeLabel(a).localeCompare(getLessonTypeLabel(b), 'ru'))

          if (query) {
            const subjectHaystack = buildSearchKey(`${subject} ${types.map(getLessonTypeLabel).join(' ')} ${courseIndex.course} курс`)
            const hasSubjectMatch = subjectHaystack.includes(query)
            const hasNestedMatch = subjectLessons.some((lesson) => {
              const group = courseIndex.groupsById.get(lesson.group)
              return buildSearchKey(`${group?.name || ''} ${lesson.subgroup || ''}`).includes(query)
            })
            if (!hasSubjectMatch && !hasNestedMatch) return
          }

          const groupResults: PlanFactGroup[] = []

          courseIndex.groups.forEach((group) => {
            const groupLessons = subjectBucket.byGroup.get(group.id) || []
            if (groupLessons.length === 0) return

            const slotNames = planFactSubgroupSlots(groupLessons)
            const hasSubgroups = slotNames.some((slot) => slot !== null)

            if (!hasSubgroups) {
              const typeMap = new Map<LessonType, AnalyticsCell>()
              groupLessons.forEach((lesson) => {
                const type = getActiveType(lesson.type)
                if (!typeMap.has(type)) typeMap.set(type, emptyCell())
                const typeCell = typeMap.get(type)!
                const pairCount = pairsFor(lesson)
                typeCell.scheduled += pairCount
                if (isLessonBeforeToday(lesson, todayStamp)) typeCell.done += pairCount
              })
              const typeRows: PlanFactTypeRowExport[] = Array.from(typeMap.keys())
                .sort((a, b) => getLessonTypeLabel(a).localeCompare(getLessonTypeLabel(b), 'ru'))
                .map((type) => buildPlanFactTypeRow(type, subject, group.id, null, coursePlan, typeMap.get(type)!))

              const aggregated = emptyCell()
              typeRows.forEach((row) => addCell(aggregated, row.cell))

              groupResults.push({
                groupId: group.id,
                groupName: group.name,
                department: group.department,
                hasSubgroups: false,
                types: typeRows,
                subgroups: [],
                totalPlanned: aggregated.planned ?? 0,
                totalScheduled: aggregated.scheduled,
                totalDone: aggregated.done,
              })
              return
            }

            const subgroupResults: PlanFactSubgroup[] = slotNames
              .map((subgroupName) => buildPlanFactSubgroupRow(subgroupName, groupLessons, subject, group.id, coursePlan, todayStamp))
              .filter((row): row is PlanFactSubgroup => row !== null)

            if (subgroupResults.length === 0) return

            const groupTypeMap = new Map<LessonType, AnalyticsCell>()
            subgroupResults.forEach((subgroup) => {
              subgroup.types.forEach((typeRow) => {
                if (!groupTypeMap.has(typeRow.type)) groupTypeMap.set(typeRow.type, emptyCell())
                addCell(groupTypeMap.get(typeRow.type)!, typeRow.cell)
              })
            })
            const groupTypes: PlanFactTypeRowExport[] = Array.from(groupTypeMap.keys())
              .sort((a, b) => getLessonTypeLabel(a).localeCompare(getLessonTypeLabel(b), 'ru'))
              .map((type) => buildPlanFactTypeRow(type, subject, group.id, null, coursePlan, groupTypeMap.get(type)!))

            groupResults.push({
              groupId: group.id,
              groupName: group.name,
              department: group.department,
              hasSubgroups: true,
              types: groupTypes,
              subgroups: subgroupResults,
              totalPlanned: groupTypes.reduce((sum, row) => sum + (row.cell.planned ?? 0), 0),
              totalScheduled: groupTypes.reduce((sum, row) => sum + row.cell.scheduled, 0),
              totalDone: groupTypes.reduce((sum, row) => sum + row.cell.done, 0),
            })
          })

          if (groupResults.length === 0) return

          subjectResults.push({
            subject,
            types,
            groups: groupResults,
            totalPlanned: groupResults.reduce((sum, group) => sum + group.totalPlanned, 0),
            totalScheduled: groupResults.reduce((sum, group) => sum + group.totalScheduled, 0),
            totalDone: groupResults.reduce((sum, group) => sum + group.totalDone, 0),
          })
        })

      return {
        course: courseIndex.course,
        subjects: subjectResults,
        totalPlanned: subjectResults.reduce((sum, subject) => sum + subject.totalPlanned, 0),
        totalScheduled: subjectResults.reduce((sum, subject) => sum + subject.totalScheduled, 0),
        totalDone: subjectResults.reduce((sum, subject) => sum + subject.totalDone, 0),
      }
    })
    .filter((course) => course.subjects.length > 0)
}
