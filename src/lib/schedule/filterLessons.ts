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

export function applyLessonFilters(
  lessons: ScheduleLesson[],
  groups: ScheduleGroup[],
  filters: FiltersState,
  search = filters.search,
) {
  const groupById = new Map(groups.map((group) => [group.id, group]))
  const query = normalizeSearchQuery(search)
  return lessons.filter((lesson) => {
    if (filters.group !== 'all' && lesson.group !== filters.group) return false
    if (filters.subgroup !== 'all') {
      const subgroup = lesson.subgroup || ''
      if (!subgroup.split(/[,\s;/]+/).includes(filters.subgroup)) return false
    }
    if (filters.lessonTypes.length > 0 && !filters.lessonTypes.includes(lesson.type)) return false
    if (!query) return true
    const group = groupById.get(lesson.group)
    const haystack = normalizeSearchQuery([
      lesson.subject,
      lesson.teacher,
      lesson.room,
      group?.name,
      lesson.subgroup,
      lesson.comment,
      lesson.day,
      lesson.date,
      getLessonTypeLabel(lesson.type),
    ].filter(Boolean).join(' '))
    return haystack.includes(query)
  })
}
