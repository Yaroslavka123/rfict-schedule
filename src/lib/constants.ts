import type { LessonType } from '@/types/schedule'

export const LESSON_TYPE_LABELS: Record<LessonType, string> = {
  lecture: 'Лекция',
  lab: 'Лаба',
  practice: 'Практика',
  seminar: 'Семинар',
  curator_hour: 'Кураторский час',
  additional: 'ДО',
  unknown: '—',
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

export const PAIR_TIMES: Record<number, string> = {
  1: '8:30 – 10:00',
  2: '10:10 – 11:40',
  3: '12:10 – 13:40',
  4: '13:50 – 15:20',
  5: '15:30 – 17:00',
  6: '17:10 – 18:40',
  7: '18:50 – 20:20',
  8: '20:30 – 22:00',
}

export const LECTURE_HALLS = ['115', '117', '119']
