import { buildSearchKey } from '@/lib/utils'
import type { RoomCell, RoomOccupancyIndex, RoomSlotEntry, TeacherCell, TeacherOccupancyIndex, TeacherSlotEntry } from '@/stores/scheduleStore'
import type { LessonType } from '@/types/schedule'

type WorkerRequest =
  | { type: 'set-rooms-source'; source: RoomOccupancyIndex | null }
  | { type: 'set-teachers-source'; source: TeacherOccupancyIndex | null }
  | { type: 'run-rooms'; id: number; activeGroup: string; query: string; types: LessonType[] }
  | { type: 'run-teachers'; id: number; activeGroup: string; query: string; types: LessonType[] }

type WorkerResponse =
  | { type: 'rooms-result'; id: number; filtered: RoomOccupancyIndex | null; matches: string[] | null }
  | { type: 'teachers-result'; id: number; filtered: TeacherOccupancyIndex | null; matches: string[] | null }

let roomsSource: RoomOccupancyIndex | null = null
let teachersSource: TeacherOccupancyIndex | null = null

function summarizeRoomEntries(entries: RoomSlotEntry[]): RoomCell {
  return {
    entries,
    allCancelled: entries.every((entry) => entry.cancelled),
    types: Array.from(new Set(entries.map((entry) => entry.type))),
    groups: Array.from(new Set(entries.map((entry) => entry.group).filter(Boolean))),
    teachers: Array.from(new Set(entries.map((entry) => entry.teacher).filter(Boolean))),
    first: entries[0],
  }
}

function summarizeTeacherEntries(entries: TeacherSlotEntry[]): TeacherCell {
  return {
    entries,
    allCancelled: entries.every((entry) => entry.cancelled),
    types: Array.from(new Set(entries.map((entry) => entry.type))),
    rooms: Array.from(new Set(entries.map((entry) => entry.room).filter(Boolean))),
  }
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

function filterRoomData(
  source: RoomOccupancyIndex | null,
  activeGroup: string,
  query: string,
  types: LessonType[],
): RoomOccupancyIndex | null {
  if (!source) return null
  if (activeGroup === 'all' && !query && types.length === 0) return source

  const occupancy: RoomOccupancyIndex['occupancy'] = {}

  source.orderedRooms.forEach((room) => {
    const days = source.occupancy[room]
    if (!days) return

    Object.entries(days).forEach(([day, pairs]) => {
      Object.entries(pairs).forEach(([pair, cell]) => {
        const entries = cell.entries.filter((entry) => roomEntryMatches(entry, activeGroup, query, types))
        if (entries.length === 0) return
        if (!occupancy[room]) occupancy[room] = {}
        if (!occupancy[room][day]) occupancy[room][day] = {}
        occupancy[room][day][Number(pair)] = summarizeRoomEntries(entries)
      })
    })
  })

  return {
    orderedRooms: source.orderedRooms,
    categoryByRoom: source.categoryByRoom,
    categoryStart: source.categoryStart,
    occupancy,
  }
}

function filterTeacherData(
  source: TeacherOccupancyIndex | null,
  activeGroup: string,
  activeTypes: LessonType[],
): TeacherOccupancyIndex | null {
  if (!source) return null
  if (activeGroup === 'all' && activeTypes.length === 0) return source

  const occupancy: TeacherOccupancyIndex['occupancy'] = {}

  source.orderedTeachers.forEach((teacher) => {
    const days = source.occupancy[teacher]
    if (!days) return

    Object.entries(days).forEach(([day, pairs]) => {
      Object.entries(pairs).forEach(([pair, cell]) => {
        const entries = cell.entries.filter((entry) => teacherEntryMatches(entry, activeGroup, activeTypes))
        if (entries.length === 0) return
        if (!occupancy[teacher]) occupancy[teacher] = {}
        if (!occupancy[teacher][day]) occupancy[teacher][day] = {}
        occupancy[teacher][day][Number(pair)] = summarizeTeacherEntries(entries)
      })
    })
  })

  return {
    orderedTeachers: source.orderedTeachers,
    occupancy,
    searchKeyByTeacher: source.searchKeyByTeacher,
  }
}

function buildRoomMatches(data: RoomOccupancyIndex | null, query: string) {
  if (!query) return null
  if (!data) return []

  const matches = new Set<string>()
  data.orderedRooms.forEach((room) => {
    if (buildSearchKey(room).includes(query)) {
      matches.add(room)
      return
    }

    const days = data.occupancy[room]
    if (!days) return
    if (Object.values(days).some((pairs) => Object.values(pairs).some((cell) => cell.entries.length > 0))) {
      matches.add(room)
    }
  })

  return Array.from(matches)
}

function buildTeacherMatches(data: TeacherOccupancyIndex | null, query: string) {
  if (!query) return null
  if (!data) return []

  const matches = new Set<string>()
  data.orderedTeachers.forEach((teacher) => {
    if ((data.searchKeyByTeacher[teacher] || '').includes(query)) matches.add(teacher)
  })

  return Array.from(matches)
}

function post(response: WorkerResponse) {
  self.postMessage(response)
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const message = event.data

  if (message.type === 'set-rooms-source') {
    roomsSource = message.source
    return
  }

  if (message.type === 'set-teachers-source') {
    teachersSource = message.source
    return
  }

  if (message.type === 'run-rooms') {
    const filtered = filterRoomData(roomsSource, message.activeGroup, message.query, message.types)
    post({
      type: 'rooms-result',
      id: message.id,
      filtered,
      matches: buildRoomMatches(filtered, message.query),
    })
    return
  }

  if (message.type === 'run-teachers') {
    const filtered = filterTeacherData(teachersSource, message.activeGroup, message.types)
    post({
      type: 'teachers-result',
      id: message.id,
      filtered,
      matches: buildTeacherMatches(filtered, message.query),
    })
  }
}
