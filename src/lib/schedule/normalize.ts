import { LECTURE_HALLS } from '@/lib/constants'

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

export function normalizeTeacherName(name: string | null) {
  return String(name || '').replace(/\s+/g, ' ').trim()
}
