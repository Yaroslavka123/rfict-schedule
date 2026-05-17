import type { LessonType } from '@/types/schedule'

export const LESSON_TYPE_LABELS: Record<LessonType, string> = {
  lecture: 'Лекция',
  lab: 'Лабораторная',
  practice: 'Практика',
  seminar: 'Семинар',
  curator_hour: 'Кураторский час',
  additional: 'ДО',
  unknown: 'Неизвестно',
}

export const LESSON_TYPE_TONES: Record<LessonType, 'green' | 'blue' | 'orange' | 'purple' | 'muted'> = {
  lecture: 'green',
  lab: 'orange',
  practice: 'blue',
  seminar: 'muted',
  curator_hour: 'purple',
  additional: 'purple',
  unknown: 'muted',
}

export const DAY_ORDER = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
export const PAIRS = [1, 2, 3, 4, 5, 6, 7, 8]
export const COURSES = [1, 2, 3, 4]
export const WEEKS = Array.from({ length: 18 }, (_, index) => index + 1)
