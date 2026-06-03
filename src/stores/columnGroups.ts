import { writable } from 'svelte/store'

export type ColumnGroupScope = 'rooms' | 'teachers'

export interface ColumnGroup {
  id: string
  name: string
  items: string[]
  collapsed: boolean
  isBuiltIn: boolean
}

export interface ColumnSection {
  id: string
  type: 'group' | 'column'
  name: string
  groupId?: string
  tone?: number
  columns: string[]
}

export interface ColumnSlot {
  id: string
  type: 'group-empty' | 'column'
  column?: string
  groupId?: string
  tone?: number
  groupStart?: boolean
  groupEnd?: boolean
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

function cleanGroupName(name: string, fallback: string) {
  const trimmed = name.trim()
  return trimmed || fallback
}

export const columnGroupsStore = {
  subscribe: store.subscribe,
  addGroup(scope: ColumnGroupScope, name = '') {
    updateScope(scope, (groups) => [
      ...groups,
      {
        id: `${scope}-${Date.now()}`,
        name: cleanGroupName(name, nextGroupName(groups)),
        items: [],
        collapsed: false,
        isBuiltIn: false,
      },
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
  unassignItem(scope: ColumnGroupScope, item: string) {
    updateScope(scope, (groups) =>
      groups.map((group) => ({ ...group, items: group.items.filter((current) => current !== item) })),
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

export function columnGroupIdByItem(groups: ColumnGroup[], columns: string[]) {
  const available = new Set(columns)
  const result: Record<string, string> = {}
  groups.forEach((group) => {
    group.items.forEach((item) => {
      if (available.has(item)) result[item] = group.id
    })
  })
  return result
}

export function buildColumnSections(columns: string[], groups: ColumnGroup[]): ColumnSection[] {
  const groupIdByItem = columnGroupIdByItem(groups, columns)
  const groupById = new Map(groups.map((group) => [group.id, group]))
  const groupToneById = new Map(groups.map((group, index) => [group.id, index % 6]))
  const renderedGroups = new Set<string>()
  const sections: ColumnSection[] = []

  groups.forEach((group) => {
    const hasVisibleColumns = columns.some((column) => groupIdByItem[column] === group.id)
    if (hasVisibleColumns) return
    renderedGroups.add(group.id)
    sections.push({
      id: group.id,
      type: 'group',
      name: group.name,
      groupId: group.id,
      tone: groupToneById.get(group.id),
      columns: [],
    })
  })

  columns.forEach((column) => {
    const groupId = groupIdByItem[column]
    if (!groupId) {
      sections.push({ id: `column:${column}`, type: 'column', name: '', columns: [column] })
      return
    }

    if (renderedGroups.has(groupId)) return

    const group = groupById.get(groupId)
    if (!group) return

    renderedGroups.add(groupId)
    sections.push({
      id: group.id,
      type: 'group',
      name: group.name,
      groupId: group.id,
      tone: groupToneById.get(group.id),
      columns: columns.filter((item) => groupIdByItem[item] === group.id),
    })
  })

  return sections
}

export function buildColumnSlots(sections: ColumnSection[]): ColumnSlot[] {
  return sections.flatMap((section) => {
    if (section.type === 'column') {
      const column = section.columns[0]
      return column ? [{ id: `column:${column}`, type: 'column' as const, column }] : []
    }

    if (section.columns.length === 0) {
      return [{
        id: `group-empty:${section.groupId}`,
        type: 'group-empty' as const,
        groupId: section.groupId,
        tone: section.tone,
        groupStart: true,
        groupEnd: true,
      }]
    }

    return section.columns.map((column, index) => ({
      id: `group:${section.groupId}:${column}`,
      type: 'column' as const,
      column,
      groupId: section.groupId,
      tone: section.tone,
      groupStart: index === 0,
      groupEnd: index === section.columns.length - 1,
    }))
  })
}
