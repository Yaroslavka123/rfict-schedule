import type { ScheduleLesson } from '@/types/schedule'

export function buildStats(lessons: ScheduleLesson[]) {
  const cancelled = lessons.filter((lesson) => lesson.cancelled).length
  const active = lessons.length - cancelled
  const lectures = lessons.filter((lesson) => lesson.type === 'lecture').length
  const labs = lessons.filter((lesson) => lesson.type === 'lab').length
  const practices = lessons.filter((lesson) => lesson.type === 'practice').length
  const subjects = new Set(lessons.map((lesson) => lesson.subject).filter(Boolean)).size
  const teachers = new Set(lessons.map((lesson) => lesson.teacher).filter(Boolean)).size
  const rooms = new Set(lessons.map((lesson) => lesson.room).filter(Boolean)).size
  return { total: lessons.length, active, cancelled, lectures, labs, practices, subjects, teachers, rooms }
}
