import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function pluralPair(value: number) {
  const abs = Math.abs(value)
  const mod10 = abs % 10
  const mod100 = abs % 100
  if (mod10 === 1 && mod100 !== 11) return `${value} пара`
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${value} пары`
  return `${value} пар`
}

export function formatUpdatedAt(iso: string) {
  const time = new Date(iso).getTime()
  if (Number.isNaN(time)) return 'обновлено недавно'
  const diffSeconds = Math.max(1, Math.round((Date.now() - time) / 1000))
  if (diffSeconds < 60) return `обновлено ${diffSeconds} сек назад`
  const minutes = Math.round(diffSeconds / 60)
  if (minutes < 60) return `обновлено ${minutes} мин назад`
  const hours = Math.round(minutes / 60)
  return `обновлено ${hours} ч назад`
}

export function normalizeText(value: string | null | undefined) {
  return String(value || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim()
}
