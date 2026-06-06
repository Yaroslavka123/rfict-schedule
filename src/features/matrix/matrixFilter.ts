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
  roomSearchKeyCache.set(room, key)
  return key
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

  source.orderedRooms.forEach((room) => {
    const roomNameMatches = query ? getRoomSearchKey(room).includes(query) : false
    let hasMatchingCell = false
    const days = source.occupancy[room]

    if (days) {
      Object.entries(days).forEach(([day, pairs]) => {
        Object.entries(pairs).forEach(([pair, cell]) => {
          let entryIndexes: number[] | null = null
          let matchedCount = 0
          cell.entries.forEach((entry, index) => {
            if (roomEntryMatches(entry, activeGroup, query, types)) {
              matchedCount += 1
              entryIndexes?.push(index)
            } else if (entryIndexes === null) {
              entryIndexes = Array.from({ length: matchedCount }, (_, matchedIndex) => matchedIndex)
            }
          })
          if (matchedCount === 0) return
          hasMatchingCell = true
          cells.push([roomSlotKey(room, day, Number(pair)), entryIndexes])
        })
      })
    }

    if (matches && (roomNameMatches || hasMatchingCell)) matches.add(room)
  })

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

  source.orderedTeachers.forEach((teacher) => {
    if (matches && (source.searchKeyByTeacher[teacher] || '').includes(query)) {
      matches.add(teacher)
    }

    if (!cells) return
    const days = source.occupancy[teacher]
    if (!days) return

    Object.entries(days).forEach(([day, pairs]) => {
      Object.entries(pairs).forEach(([pair, cell]) => {
        let entryIndexes: number[] | null = null
        let matchedCount = 0
        cell.entries.forEach((entry, index) => {
          if (teacherEntryMatches(entry, activeGroup, types)) {
            matchedCount += 1
            entryIndexes?.push(index)
          } else if (entryIndexes === null) {
            entryIndexes = Array.from({ length: matchedCount }, (_, matchedIndex) => matchedIndex)
          }
        })
        if (matchedCount > 0) cells.push([teacherSlotKey(teacher, day, Number(pair)), entryIndexes])
      })
    })
  })

  return {
    cells,
    matches: matches ? Object.freeze(matches) : null,
  }
}
