import { writable } from 'svelte/store'

export type ColumnOrderScope = 'rooms' | 'teachers'

type ColumnOrderState = Record<ColumnOrderScope, string[]>
type DropSide = 'before' | 'after'

const STORAGE_KEYS: Record<ColumnOrderScope, string> = {
  rooms: 'rfict-room-order',
  teachers: 'rfict-teacher-order',
}

function readOrder(scope: ColumnOrderScope) {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEYS[scope])
    const parsed = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function initialState(): ColumnOrderState {
  return {
    rooms: readOrder('rooms'),
    teachers: readOrder('teachers'),
  }
}

const store = writable<ColumnOrderState>(initialState())

if (typeof localStorage !== 'undefined') {
  store.subscribe((state) => {
    ;(['rooms', 'teachers'] as const).forEach((scope) => {
      localStorage.setItem(STORAGE_KEYS[scope], JSON.stringify(state[scope]))
    })
  })
}

export function applyColumnOrder(columns: string[], savedOrder: string[]) {
  const available = new Set(columns)
  const ordered = savedOrder.filter((column) => available.has(column))
  const seen = new Set(ordered)
  return [...ordered, ...columns.filter((column) => !seen.has(column))]
}

function moveColumn(columns: string[], source: string, target: string, side: DropSide) {
  if (source === target || !columns.includes(source) || !columns.includes(target)) return columns

  const next = columns.filter((column) => column !== source)
  const targetIndex = next.indexOf(target)
  if (targetIndex === -1) return columns

  next.splice(side === 'after' ? targetIndex + 1 : targetIndex, 0, source)
  return next
}

function moveColumnToEnd(columns: string[], source: string) {
  if (!columns.includes(source)) return columns
  return [...columns.filter((column) => column !== source), source]
}

export const columnOrderStore = {
  subscribe: store.subscribe,
  move(scope: ColumnOrderScope, columns: string[], source: string, target: string, side: DropSide) {
    store.update((state) => ({
      ...state,
      [scope]: moveColumn(columns, source, target, side),
    }))
  },
  moveToEnd(scope: ColumnOrderScope, columns: string[], source: string) {
    store.update((state) => ({
      ...state,
      [scope]: moveColumnToEnd(columns, source),
    }))
  },
}
