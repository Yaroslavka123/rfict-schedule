import { LECTURE_HALLS } from '@/lib/constants'

export function normalizeRoom(room: string | null | undefined): string {
  if (!room) return ''
  return String(room).replace(/[KkКк](\s*)(\d)/g, 'К$2').trim()
}

const categorizeRoomCache = new Map<string, { label: string; order: number; tone: 'lecture-hall' | 'computer' | 'regular' }>()

export function categorizeRoom(room: string) {
  const cached = categorizeRoomCache.get(room)
  if (cached) return cached
  const normalized = normalizeRoom(room)
  let result: { label: string; order: number; tone: 'lecture-hall' | 'computer' | 'regular' }
  if (LECTURE_HALLS.includes(normalized)) result = { label: 'Лекционный зал', order: 1, tone: 'lecture-hall' }
  else if (/К\s*\d/.test(normalized)) result = { label: 'Компьютерный класс', order: 2, tone: 'computer' }
  else result = { label: 'Кабинет', order: 3, tone: 'regular' }
  if (categorizeRoomCache.size > 500) categorizeRoomCache.clear()
  categorizeRoomCache.set(room, result)
  return result
}

export function normalizeTeacherName(name: string | null) {
  return String(name || '').replace(/\s+/g, ' ').trim()
}
