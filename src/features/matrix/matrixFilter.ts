import { buildSearchKey } from '@/lib/utils'
import type {
  RoomOccupancyIndex,
  RoomSlotEntry,
  TeacherOccupancyIndex,
  TeacherSlotEntry,
} from '@/stores/scheduleStore'
import type { LessonType } from '@/types/schedule'

export type MatrixCellFilter = [key: string, entryIndexes: number[] | null][]

const roomSearchKeyCache = new Map<string, string>()
const ROOM_SEARCH_KEY_CACHE_LIMIT = 500

export interface RoomMatrixFilterResult {
  cells: MatrixCellFilter | null
  matches: ReadonlySet<string> | null
}

export interface TeacherMatrixFilterResult {
  cells: MatrixCellFilter | null
  matches: ReadonlySet<string> | null
}

export function roomSlotKey(room: string, day: string, pair: number) {
  return `${encodeURIComponent(room)}|${day}|${pair}`
}

export function teacherSlotKey(teacher: string, day: string, pair: number) {
  return `${encodeURIComponent(teacher)}|${day}|${pair}`
}

function roomEntryMatches(entry: RoomSlotEntry, activeGroup: string, query: string, types: LessonType[]) {
  if (activeGroup !== 'all' && entry.groupId !== activeGroup) return false
  if (types.length > 0 && !types.includes(entry.type)) return false
  return !query || entry.searchKey.includes(query)
}

function teacherEntryMatches(entry: TeacherSlotEntry, activeGroup: string, types: LessonType[]) {
  if (activeGroup !== 'all' && entry.groupId !== activeGroup) return false
  if (types.length > 0 && !types.includes(entry.type)) return false
  return true
}

function getRoomSearchKey(room: string) {
  const cached = roomSearchKeyCache.get(room)
  if (cached !== undefined) return cached
  const key = buildSearchKey(room)
  if (roomSearchKeyCache.size > ROOM_SEARCH_KEY_CACHE_LIMIT) roomSearchKeyCache.clear()
  roomSearchKeyCache.set(room, key)
  return key
}

function collectMatchingEntryIndexes<T>(
  entries: T[],
  matches: (entry: T) => boolean,
): { matchedCount: number; entryIndexes: number[] | null } {
  let entryIndexes: number[] | null = null
  let matchedCount = 0

  for (let index = 0; index < entries.length; index += 1) {
    if (matches(entries[index])) {
      if (entryIndexes) entryIndexes.push(index)
      matchedCount += 1
    } else if (entryIndexes === null) {
      entryIndexes = []
      for (let matchedIndex = 0; matchedIndex < matchedCount; matchedIndex += 1) {
        entryIndexes.push(matchedIndex)
      }
    }
  }

  return { matchedCount, entryIndexes }
}

export function filterRoomMatrix(
  source: RoomOccupancyIndex | null,
  activeGroup: string,
  query: string,
  types: LessonType[],
): RoomMatrixFilterResult {
  if (!source) return { cells: null, matches: null }
  if (activeGroup === 'all' && !query && types.length === 0) return { cells: null, matches: null }

  const cells: MatrixCellFilter = []
  const matches = query ? new Set<string>() : null

  for (let roomIndex = 0; roomIndex < source.orderedRooms.length; roomIndex += 1) {
    const room = source.orderedRooms[roomIndex]
    const roomNameMatches = query ? getRoomSearchKey(room).includes(query) : false
    let hasMatchingCell = false
    const days = source.occupancy[room]

    if (days) {
      const dayKeys = Object.keys(days)
      for (let dayIndex = 0; dayIndex < dayKeys.length; dayIndex += 1) {
        const day = dayKeys[dayIndex]
        const pairs = days[day]
        const pairKeys = Object.keys(pairs)
        for (let pairIndex = 0; pairIndex < pairKeys.length; pairIndex += 1) {
          const pair = Number(pairKeys[pairIndex])
          const cell = pairs[pair]
          const { matchedCount, entryIndexes } = collectMatchingEntryIndexes(cell.entries, (entry) => (
            roomEntryMatches(entry, activeGroup, query, types)
          ))
          if (matchedCount === 0) continue
          hasMatchingCell = true
          cells.push([roomSlotKey(room, day, pair), entryIndexes])
        }
      }
    }

    if (matches && (roomNameMatches || hasMatchingCell)) matches.add(room)
  }

  return {
    cells,
    matches: matches ? Object.freeze(matches) : null,
  }
}

export function filterTeacherMatrix(
  source: TeacherOccupancyIndex | null,
  activeGroup: string,
  query: string,
  types: LessonType[],
): TeacherMatrixFilterResult {
  if (!source) return { cells: null, matches: null }
  if (activeGroup === 'all' && !query && types.length === 0) return { cells: null, matches: null }

  const shouldFilterCells = activeGroup !== 'all' || types.length > 0
  const cells: MatrixCellFilter | null = shouldFilterCells ? [] : null
  const matches = query ? new Set<string>() : null

  for (let teacherIndex = 0; teacherIndex < source.orderedTeachers.length; teacherIndex += 1) {
    const teacher = source.orderedTeachers[teacherIndex]
    if (matches && (source.searchKeyByTeacher[teacher] || '').includes(query)) {
      matches.add(teacher)
    }

    if (!cells) continue
    const days = source.occupancy[teacher]
    if (!days) continue

    const dayKeys = Object.keys(days)
    for (let dayIndex = 0; dayIndex < dayKeys.length; dayIndex += 1) {
      const day = dayKeys[dayIndex]
      const pairs = days[day]
      const pairKeys = Object.keys(pairs)
      for (let pairIndex = 0; pairIndex < pairKeys.length; pairIndex += 1) {
        const pair = Number(pairKeys[pairIndex])
        const cell = pairs[pair]
        const { matchedCount, entryIndexes } = collectMatchingEntryIndexes(cell.entries, (entry) => (
          teacherEntryMatches(entry, activeGroup, types)
        ))
        if (matchedCount > 0) cells.push([teacherSlotKey(teacher, day, pair), entryIndexes])
      }
    }
  }

  return {
    cells,
    matches: matches ? Object.freeze(matches) : null,
  }
}
