import { LESSON_TYPE_LABELS } from '@/lib/constants'
import { normalizeSearchQuery } from '@/lib/utils/searchText'
import type { FiltersState, LessonType, ScheduleGroup, ScheduleLesson } from '@/types/schedule'

export function getLessonTypeLabel(type: LessonType) {
  return LESSON_TYPE_LABELS[type] || LESSON_TYPE_LABELS.unknown
}

export function getPairRange(lesson: ScheduleLesson) {
  const duration = Math.max(lesson.duration || 1, 1)
  if (duration === 1) return String(lesson.pair)
  return `${lesson.pair}-${lesson.pair + duration - 1}`
}

export function getGoogleSheetUrl(lesson: Pick<ScheduleLesson, 'google_sheet_id'>) {
  return lesson.google_sheet_id
    ? `https://docs.google.com/spreadsheets/d/${lesson.google_sheet_id}/edit`
    : null
}

function buildLessonSearchHaystack(lesson: ScheduleLesson, groupName: string | undefined): string {
  return normalizeSearchQuery([
    lesson.subject,
    lesson.teacher,
    lesson.room,
    groupName,
    lesson.subgroup,
    lesson.comment,
    lesson.day,
    lesson.date,
    getLessonTypeLabel(lesson.type),
  ].filter(Boolean).join(' '))
}

export function applyLessonFilters(
  lessons: ScheduleLesson[],
  groups: ScheduleGroup[],
  filters: FiltersState,
  search = filters.search,
) {
  const groupById = new Map(groups.map((group) => [group.id, group]))
  const query = normalizeSearchQuery(search)
  if (!query) {
    return lessons.filter((lesson) => {
      if (filters.group !== 'all' && lesson.group !== filters.group) return false
      if (filters.subgroup !== 'all') {
        const subgroup = lesson.subgroup || ''
        if (!subgroup.split(/[,\s;/]+/).includes(filters.subgroup)) return false
      }
      if (filters.lessonTypes.length > 0 && !filters.lessonTypes.includes(lesson.type)) return false
      return true
    })
  }
  const haystacks = lessons.map((lesson) => buildLessonSearchHaystack(lesson, groupById.get(lesson.group)?.name))
  return lessons.filter((lesson, i) => {
    if (filters.group !== 'all' && lesson.group !== filters.group) return false
    if (filters.subgroup !== 'all') {
      const subgroup = lesson.subgroup || ''
      if (!subgroup.split(/[,\s;/]+/).includes(filters.subgroup)) return false
    }
    if (filters.lessonTypes.length > 0 && !filters.lessonTypes.includes(lesson.type)) return false
    return haystacks[i].includes(query)
  })
}
