import { writable } from 'svelte/store'

export type ColumnGroupScope = 'rooms' | 'teachers'

export interface ColumnGroup {
  id: string
  name: string
  items: string[]
  collapsed: boolean
  isBuiltIn: boolean
}

type ColumnGroupsState = Record<ColumnGroupScope, ColumnGroup[]>

const STORAGE_KEYS: Record<ColumnGroupScope, string> = {
  rooms: 'rfict-room-groups',
  teachers: 'rfict-teacher-groups',
}

function readGroups(scope: ColumnGroupScope, fallback: ColumnGroup[]) {
  if (typeof localStorage === 'undefined') return fallback
  try {
    const raw = localStorage.getItem(STORAGE_KEYS[scope])
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as ColumnGroup[]
    return Array.isArray(parsed) ? parsed : fallback
  } catch {
    return fallback
  }
}

function initialState(): ColumnGroupsState {
  return {
    rooms: readGroups('rooms', []),
    teachers: readGroups('teachers', []),
  }
}

const store = writable<ColumnGroupsState>(initialState())

if (typeof localStorage !== 'undefined') {
  store.subscribe((state) => {
    ;(['rooms', 'teachers'] as const).forEach((scope) => {
      localStorage.setItem(STORAGE_KEYS[scope], JSON.stringify(state[scope]))
    })
  })
}

function updateScope(scope: ColumnGroupScope, mapper: (groups: ColumnGroup[]) => ColumnGroup[]) {
  store.update((state) => ({ ...state, [scope]: mapper(state[scope]) }))
}

function nextGroupName(groups: ColumnGroup[]) {
  return `Группа ${groups.length + 1}`
}

export const columnGroupsStore = {
  subscribe: store.subscribe,
  addGroup(scope: ColumnGroupScope) {
    updateScope(scope, (groups) => [
      ...groups,
      { id: `${scope}-${Date.now()}`, name: nextGroupName(groups), items: [], collapsed: false, isBuiltIn: false },
    ])
  },
  removeGroup(scope: ColumnGroupScope, id: string) {
    updateScope(scope, (groups) => groups.filter((group) => group.id !== id))
  },
  renameGroup(scope: ColumnGroupScope, id: string, name: string) {
    updateScope(scope, (groups) => groups.map((group) => (group.id === id ? { ...group, name } : group)))
  },
  addItem(scope: ColumnGroupScope, groupId: string, item: string) {
    updateScope(scope, (groups) =>
      groups.map((group) =>
        group.id === groupId && !group.items.includes(item)
          ? { ...group, items: [...group.items, item] }
          : group,
      ),
    )
  },
  assignItem(scope: ColumnGroupScope, groupId: string, item: string) {
    updateScope(scope, (groups) =>
      groups.map((group) => {
        const items = group.items.filter((current) => current !== item)
        return group.id === groupId ? { ...group, items: [...items, item] } : { ...group, items }
      }),
    )
  },
  removeItem(scope: ColumnGroupScope, groupId: string, item: string) {
    updateScope(scope, (groups) =>
      groups.map((group) =>
        group.id === groupId ? { ...group, items: group.items.filter((current) => current !== item) } : group,
      ),
    )
  },
  reorder(scope: ColumnGroupScope, fromIdx: number, toIdx: number) {
    updateScope(scope, (groups) => {
      const next = [...groups]
      const [moved] = next.splice(fromIdx, 1)
      if (!moved) return groups
      next.splice(toIdx, 0, moved)
      return next
    })
  },
  toggleCollapse(scope: ColumnGroupScope, id: string) {
    updateScope(scope, (groups) =>
      groups.map((group) => (group.id === id ? { ...group, collapsed: !group.collapsed } : group)),
    )
  },
}

export function columnGroupNameByItem(groups: ColumnGroup[], columns: string[]) {
  const available = new Set(columns)
  const result: Record<string, string> = {}
  groups.forEach((group) => {
    group.items.forEach((item) => {
      if (available.has(item)) result[item] = group.name
    })
  })
  return result
}

export function columnGroupStartByItem(columns: string[], groupNameByItem: Record<string, string>) {
  const result: Record<string, boolean> = {}
  let previous = ''
  columns.forEach((column) => {
    const current = groupNameByItem[column] || ''
    result[column] = Boolean(current && current !== previous)
    previous = current
  })
  return result
}
