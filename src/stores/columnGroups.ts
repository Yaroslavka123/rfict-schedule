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

const defaultRooms: ColumnGroup[] = [
  { id: 'lectures', name: 'Поточные', items: ['115', '117', '119'], collapsed: false, isBuiltIn: true },
  { id: 'computers', name: 'Комп. классы', items: ['К1', 'К2', 'К3'], collapsed: false, isBuiltIn: true },
  { id: 'regular', name: 'Кабинеты', items: ['101', '102', '103', '104', '105', '106'], collapsed: false, isBuiltIn: true },
]

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
    rooms: readGroups('rooms', defaultRooms),
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

export const columnGroupsStore = {
  subscribe: store.subscribe,
  addGroup(scope: ColumnGroupScope, name: string) {
    updateScope(scope, (groups) => [
      ...groups,
      { id: `${scope}-${Date.now()}`, name, items: [], collapsed: false, isBuiltIn: false },
    ])
  },
  removeGroup(scope: ColumnGroupScope, id: string) {
    updateScope(scope, (groups) => groups.filter((group) => group.id !== id || group.isBuiltIn))
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
