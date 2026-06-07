import { get, writable } from 'svelte/store'

import {
  API_BASE_URL,
  loadAllCoursesBundle,
  loadCourseBundle,
  planKey,
  saveCoursePlanEntry,
  type AllCoursesBundle,
  type CourseDataBundle,
} from '@/api/scheduleClient'
import type { MatrixCellBadge } from '@/features/matrix/matrixTypes'
import { PAIR_TIMES } from '@/lib/constants'
import {
  categorizeRoom,
  getActiveSubgroupsForLesson,
  isLessonActiveForWeek,
  normalizeRoom,
  normalizeTeacherName,
} from '@/lib/schedule'
import { buildSearchKey } from '@/lib/utils'
import type {
  CoursePlanEntry,
  CoursePlanMap,
  CourseSchedule,
  CourseSelection,
  LessonType,
  MergedSchedule,
  ScheduleGroupWithCourse,
  ScheduleLesson,
  WeekSchedule,
} from '@/types/schedule'

const CACHE_VERSION = 'v3'
const CACHE_TTL_MS = 15 * 60_000
const CACHE_WRITE_DELAY_MS = 300
const SSE_REFRESH_DEBOUNCE_MS = 500

interface CachedCourse {
  v: typeof CACHE_VERSION
  kind: 'single'
  schedule: CourseSchedule
  plan: CoursePlanMap
  fetchedAt: number
}

interface CachedAll {
  v: typeof CACHE_VERSION
  kind: 'all'
  schedule: MergedSchedule
  plans: Record<number, CoursePlanMap>
  fetchedAt: number
}

type CachedBundle = CachedCourse | CachedAll

export interface ScheduleState {
  schedule: CourseSchedule | MergedSchedule | null
  index: ScheduleIndex
  plan: CoursePlanMap
  plans: Record<number, CoursePlanMap>
  loading: boolean
  error: string | null
  loadedAt: number
}

export interface ScheduleIndex {
  weeksByNumber: Record<number, WeekSchedule[]>
  lessonsByWeek: Record<number, ScheduleLesson[]>
  lessonsByRoom: Record<string, ScheduleLesson[]>
  lessonsByTeacher: Record<string, ScheduleLesson[]>
  roomOccupancyByWeek: Record<number, RoomOccupancyIndex>
  teacherOccupancyByWeek: Record<number, TeacherOccupancyIndex>
  groupNameById: Record<string, string>
}

const emptyIndex: ScheduleIndex = {
  weeksByNumber: {},
  lessonsByWeek: {},
  lessonsByRoom: {},
  lessonsByTeacher: {},
  roomOccupancyByWeek: {},
  teacherOccupancyByWeek: {},
  groupNameById: {},
}

export type RoomCategory = 'lecture-hall' | 'computer' | 'regular'

export interface RoomSlotEntry {
  subject: string
  teacher: string
  group: string
  groupId: string
  course?: number
  type: LessonType
  subgroup: string
  time: string
  pair: number
  cancelled: boolean
  room: string
  searchKey: string
  googleSheetId?: string | null
}

export interface RoomCell {
  entries: RoomSlotEntry[]
  allCancelled: boolean
  types: LessonType[]
  groups: string[]
  teachers: string[]
  first: RoomSlotEntry
  precomputedKey: string
  precomputedMain: string
  precomputedMainClass: string | null
  precomputedMeta: string | null
  precomputedBadgeKey: string | null
  precomputedBadges: MatrixCellBadge[]
  precomputedBusyClasses: string[]
  precomputedSheetId: string | null
  precomputedHasSheet: boolean
  precomputedIsMultiTeacher: boolean
  precomputedIsMultiGroup: boolean
  precomputedTeacherCount: number
  precomputedGroupCount: number
}

export interface RoomOccupancyIndex {
  orderedRooms: string[]
  categoryByRoom: Record<string, RoomCategory>
  categoryStart: Record<string, boolean>
  occupancy: Record<string, Record<string, Record<number, RoomCell>>>
}

export interface TeacherSlotEntry {
  subject: string
  group: string
  groupId: string
  room: string
  type: LessonType
  subgroup: string
  time: string
  pair: number
  cancelled: boolean
  course?: number
  searchKey: string
  googleSheetId?: string | null
}

export interface TeacherCell {
  entries: TeacherSlotEntry[]
  allCancelled: boolean
  types: LessonType[]
  rooms: string[]
  precomputedKey: string
  precomputedMain: string
  precomputedMainClass: string | null
  precomputedMeta: string | null
  precomputedBadges: MatrixCellBadge[]
  precomputedBusyClasses: string[]
  precomputedSheetId: string | null
  precomputedHasSheet: boolean
}

export interface TeacherOccupancyIndex {
  orderedTeachers: string[]
  occupancy: Record<string, Record<string, Record<number, TeacherCell>>>
  searchKeyByTeacher: Record<string, string>
}

const initialState: ScheduleState = {
  schedule: null,
  index: emptyIndex,
  plan: {},
  plans: {},
  loading: true,
  error: null,
  loadedAt: 0,
}

const memoryCache = new Map<string, CachedBundle>()
const scheduleIndexCache = new WeakMap<CourseSchedule | MergedSchedule, ScheduleIndex>()
const writeTimers = new Map<string, ReturnType<typeof setTimeout>>()
const pendingIndexRequests = new Map<number, {
  resolve: (index: ScheduleIndex) => void
  reject: () => void
}>()
let scheduleIndexWorker: Worker | null | undefined
let scheduleIndexRequestId = 0

type ScheduleIndexWorkerMessage = {
  id: number
  index: ScheduleIndex
}

function cacheKey(course: CourseSelection) {
  return `rfict-cache-${CACHE_VERSION}-course-${course === 'all' ? 'all' : course}`
}

function readCache(course: CourseSelection): CachedBundle | null {
  if (typeof localStorage === 'undefined') return null
  const key = cacheKey(course)
  const cached = memoryCache.get(key)
  if (cached) return cached

  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as CachedBundle
    if (parsed.v !== CACHE_VERSION) return null
    memoryCache.set(key, parsed)
    return parsed
  } catch {
    return null
  }
}

function writeCache(course: CourseSelection, payload: CachedBundle) {
  const key = cacheKey(course)
  memoryCache.set(key, payload)
  if (typeof localStorage === 'undefined') return

  const previous = writeTimers.get(key)
  if (previous) clearTimeout(previous)

  writeTimers.set(
    key,
    setTimeout(() => {
      try {
        localStorage.setItem(key, JSON.stringify(payload))
      } catch {
        /* ignore */
      } finally {
        writeTimers.delete(key)
      }
    }, CACHE_WRITE_DELAY_MS),
  )
}

function cacheCourse(course: number, bundle: CourseDataBundle) {
  writeCache(course, {
    v: CACHE_VERSION,
    kind: 'single',
    schedule: bundle.schedule,
    plan: bundle.plan,
    fetchedAt: bundle.fetchedAt,
  })
}

function cacheAll(bundle: AllCoursesBundle) {
  writeCache('all', {
    v: CACHE_VERSION,
    kind: 'all',
    schedule: bundle.schedule,
    plans: bundle.plans,
    fetchedAt: bundle.fetchedAt,
  })
}

function combinePlans(plans: Record<number, CoursePlanMap>): CoursePlanMap {
  const merged: CoursePlanMap = {}
  Object.values(plans).forEach((map) => {
    Object.entries(map).forEach(([key, value]) => {
      if (merged[key] === undefined) merged[key] = value
    })
  })
  return merged
}

function numericRoomSort(a: string, b: string) {
  const orderA = categorizeRoom(a).order
  const orderB = categorizeRoom(b).order
  if (orderA !== orderB) return orderA - orderB
  const numA = parseInt(a.replace(/\D+/g, ''), 10)
  const numB = parseInt(b.replace(/\D+/g, ''), 10)
  if (!Number.isNaN(numA) && !Number.isNaN(numB) && numA !== numB) return numA - numB
  return a.localeCompare(b, 'ru', { numeric: true })
}

function getScheduleCourse(schedule: CourseSchedule | MergedSchedule) {
  return typeof schedule.course === 'number' ? schedule.course : undefined
}

function lessonCourse(
  lesson: ScheduleLesson,
  groupCourseById: Record<string, number>,
  fallback?: number,
) {
  return lesson.course_number ?? groupCourseById[lesson.group] ?? fallback
}

function buildGroupMaps(schedule: CourseSchedule | MergedSchedule) {
  const fallbackCourse = getScheduleCourse(schedule)
  const groupNameById: Record<string, string> = {}
  const groupNameByCourseAndId: Record<string, string> = {}
  const groupCourseById: Record<string, number> = {}

  schedule.groups.forEach((group) => {
    const withCourse = group as ScheduleGroupWithCourse
    const course = withCourse.course ?? fallbackCourse
    if (groupNameById[group.id] === undefined) groupNameById[group.id] = group.name
    if (course !== undefined) {
      groupNameByCourseAndId[`${course}:${group.id}`] = group.name
      groupCourseById[group.id] = course
    }
  })

  return { groupNameById, groupNameByCourseAndId, groupCourseById }
}

function getGroupName(
  groupId: string,
  course: number | undefined,
  groupNameById: Record<string, string>,
  groupNameByCourseAndId: Record<string, string>,
) {
  if (course !== undefined) return groupNameByCourseAndId[`${course}:${groupId}`] || groupNameById[groupId] || `Группа ${groupId}`
  return groupNameById[groupId] || `Группа ${groupId}`
}

function matrixSlotKey(column: string, day: string, pair: number) {
  return `${encodeURIComponent(column)}|${day}|${pair}`
}

function shortenSubject(subject: string) {
  if (!subject) return 'Занято'
  return subject.length > 16 ? `${subject.slice(0, 15)}...` : subject
}

function shortenLabel(value: string) {
  return value.length > 12 ? `${value.slice(0, 11)}...` : value
}

function compactList(values: string[], fallback: string) {
  if (values.length === 0) return fallback
  if (values.length === 1) return shortenLabel(values[0])
  return `${shortenLabel(values[0])} +${values.length - 1}`
}

function getSheetId(entries: Array<{ googleSheetId?: string | null }>) {
  return entries.find((entry) => entry.googleSheetId)?.googleSheetId || null
}

function matrixTypeClass(allCancelled: boolean, types: LessonType[]) {
  if (allCancelled) return 'slot-cancelled'
  if (types.length > 1) return 'slot-type-multi'
  return `slot-type-${types[0] || 'unknown'}`
}

export function roomCell(entries: RoomSlotEntry[], key: string): RoomCell {
  const groups = Array.from(new Set(entries.map((entry) => entry.group).filter(Boolean)))
  const teachers = Array.from(new Set(entries.map((entry) => entry.teacher).filter(Boolean)))
  const types = Array.from(new Set(entries.map((entry) => entry.type)))
  const allCancelled = entries.every((entry) => entry.cancelled)
  const first = entries[0]
  const teacherCount = teachers.length
  const groupCount = groups.length
  const isMultiTeacher = teacherCount > 1
  const isMultiGroup = groupCount > 1
  const sheetId = getSheetId(entries)
  const precomputedBadges: MatrixCellBadge[] = []

  if (isMultiTeacher) {
    precomputedBadges.push({
      className: 'slot-badge slot-badge-teacher',
      title: `Преподавателей: ${teacherCount}`,
      value: teacherCount,
    })
  }
  if (isMultiGroup) {
    precomputedBadges.push({
      className: 'slot-badge slot-badge-group',
      title: `Групп: ${groupCount}`,
      value: groupCount,
    })
  }

  return {
    entries,
    allCancelled,
    types,
    groups,
    teachers,
    first,
    precomputedKey: key,
    precomputedMain: shortenSubject(first.subject),
    precomputedMainClass: allCancelled ? 'line-through' : null,
    precomputedMeta: null,
    precomputedBadgeKey: isMultiTeacher || isMultiGroup ? `${teacherCount}-${groupCount}` : null,
    precomputedBadges,
    precomputedBusyClasses: [matrixTypeClass(allCancelled, types)],
    precomputedSheetId: sheetId,
    precomputedHasSheet: Boolean(sheetId),
    precomputedIsMultiTeacher: isMultiTeacher,
    precomputedIsMultiGroup: isMultiGroup,
    precomputedTeacherCount: teacherCount,
    precomputedGroupCount: groupCount,
  }
}

export function teacherCell(entries: TeacherSlotEntry[], key: string): TeacherCell {
  const rooms = Array.from(new Set(entries.map((entry) => entry.room).filter(Boolean)))
  const types = Array.from(new Set(entries.map((entry) => entry.type)))
  const allCancelled = entries.every((entry) => entry.cancelled)
  const sheetId = getSheetId(entries)
  const precomputedBadges: MatrixCellBadge[] = []

  if (rooms.length > 1) {
    precomputedBadges.push({
      className: 'slot-badge slot-badge-group',
      title: `Кабинетов: ${rooms.length}`,
      value: rooms.length,
    })
  }

  return {
    entries,
    allCancelled,
    types,
    rooms,
    precomputedKey: key,
    precomputedMain: compactList(rooms, 'room'),
    precomputedMainClass: allCancelled ? 'line-through' : null,
    precomputedMeta: null,
    precomputedBadges,
    precomputedBusyClasses: [matrixTypeClass(allCancelled, types)],
    precomputedSheetId: sheetId,
    precomputedHasSheet: Boolean(sheetId),
  }
}

function getCachedScheduleIndex(schedule: CourseSchedule | MergedSchedule): ScheduleIndex {
  const cached = scheduleIndexCache.get(schedule)
  if (cached) return cached
  const index = buildScheduleIndex(schedule)
  scheduleIndexCache.set(schedule, index)
  return index
}

function getScheduleIndexWorker() {
  if (scheduleIndexWorker !== undefined) return scheduleIndexWorker
  if (typeof Worker === 'undefined') {
    scheduleIndexWorker = null
    return null
  }

  try {
    const worker = new Worker(new URL('./scheduleIndexWorker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<ScheduleIndexWorkerMessage>) => {
      const pending = pendingIndexRequests.get(event.data.id)
      if (!pending) return
      pendingIndexRequests.delete(event.data.id)
      pending.resolve(event.data.index)
    }
    worker.onerror = () => {
      pendingIndexRequests.forEach((pending) => pending.reject())
      pendingIndexRequests.clear()
      scheduleIndexWorker?.terminate()
      scheduleIndexWorker = null
    }
    scheduleIndexWorker = worker
    return worker
  } catch {
    scheduleIndexWorker = null
    return null
  }
}

async function getIndexAsync(schedule: CourseSchedule | MergedSchedule): Promise<ScheduleIndex> {
  const cached = scheduleIndexCache.get(schedule)
  if (cached) return cached

  const worker = getScheduleIndexWorker()
  if (!worker) return getCachedScheduleIndex(schedule)

  try {
    const id = ++scheduleIndexRequestId
    const index = await new Promise<ScheduleIndex>((resolve, reject) => {
      pendingIndexRequests.set(id, { resolve, reject: () => reject(new Error('schedule index worker failed')) })
      try {
        worker.postMessage({ id, schedule })
      } catch (error) {
        pendingIndexRequests.delete(id)
        reject(error)
      }
    })
    scheduleIndexCache.set(schedule, index)
    return index
  } catch {
    return getCachedScheduleIndex(schedule)
  }
}

function finalizeRoomIndex(index: RoomOccupancyIndex) {
  index.orderedRooms = index.orderedRooms.sort(numericRoomSort)
  const seenCategories = new Set<RoomCategory>()
  index.orderedRooms.forEach((room) => {
    const category = categorizeRoom(room).tone as RoomCategory
    index.categoryByRoom[room] = category
    index.categoryStart[room] = !seenCategories.has(category)
    seenCategories.add(category)
  })
}

export function buildScheduleIndex(schedule: CourseSchedule | MergedSchedule | null): ScheduleIndex {
  if (!schedule) return emptyIndex
  const weeksByNumber: Record<number, WeekSchedule[]> = {}
  const lessonsByWeek: Record<number, ScheduleLesson[]> = {}
  const lessonsByRoom: Record<string, ScheduleLesson[]> = {}
  const lessonsByTeacher: Record<string, ScheduleLesson[]> = {}
  const roomEntriesByWeek: Record<number, Record<string, Record<string, Record<number, RoomSlotEntry[]>>>> = {}
  const teacherEntriesByWeek: Record<number, Record<string, Record<string, Record<number, TeacherSlotEntry[]>>>> = {}
  const { groupNameById, groupNameByCourseAndId, groupCourseById } = buildGroupMaps(schedule)
  const fallbackCourse = getScheduleCourse(schedule)
  const allRooms = Array.from(
    new Set(
      schedule.lessons
        .map((lesson) => normalizeRoom(lesson.room))
        .filter((room) => room && room !== 'ДО'),
    ),
  ).sort(numericRoomSort)

  schedule.weeks.forEach((week) => {
    if (!weeksByNumber[week.week_number]) weeksByNumber[week.week_number] = []
    weeksByNumber[week.week_number].push(week)
  })

  schedule.lessons.forEach((lesson) => {
    const week = lesson.week_number || 0
    if (!lessonsByWeek[week]) lessonsByWeek[week] = []
    lessonsByWeek[week].push(lesson)

    const room = normalizeRoom(lesson.room)
    if (room) {
      if (!lessonsByRoom[room]) lessonsByRoom[room] = []
      lessonsByRoom[room].push(lesson)
    }

    const teacher = normalizeTeacherName(lesson.teacher || '')
    if (teacher) {
      if (!lessonsByTeacher[teacher]) lessonsByTeacher[teacher] = []
      lessonsByTeacher[teacher].push(lesson)
    }

    if (!isLessonActiveForWeek(lesson, week)) return

    const course = lessonCourse(lesson, groupCourseById, fallbackCourse)
    const groupName = getGroupName(lesson.group, course, groupNameById, groupNameByCourseAndId)
    const activeSubgroups = getActiveSubgroupsForLesson(lesson, week).join(', ')
    const duration = Math.max(lesson.duration || 1, 1)

    if (room && room !== 'ДО') {
      if (!roomEntriesByWeek[week]) roomEntriesByWeek[week] = {}
      if (!roomEntriesByWeek[week][room]) roomEntriesByWeek[week][room] = {}
      if (!roomEntriesByWeek[week][room][lesson.day]) roomEntriesByWeek[week][room][lesson.day] = {}

      const searchKey = buildSearchKey(
        `${room} ${lesson.subject || ''} ${teacher} ${groupName} ${activeSubgroups} ${lesson.day || ''} ${lesson.date || ''} ${lesson.comment || ''}`,
      )

      for (let pair = lesson.pair; pair < lesson.pair + duration; pair += 1) {
        if (!roomEntriesByWeek[week][room][lesson.day][pair]) roomEntriesByWeek[week][room][lesson.day][pair] = []
        roomEntriesByWeek[week][room][lesson.day][pair].push({
          subject: lesson.subject || '',
          teacher,
          group: groupName,
          groupId: lesson.group,
          course,
          type: lesson.type,
          subgroup: activeSubgroups,
          time: PAIR_TIMES[pair] || '',
          pair,
          cancelled: Boolean(lesson.cancelled),
          room,
          searchKey,
          googleSheetId: lesson.google_sheet_id,
        })
      }
    }

    if (teacher) {
      if (!teacherEntriesByWeek[week]) teacherEntriesByWeek[week] = {}
      if (!teacherEntriesByWeek[week][teacher]) teacherEntriesByWeek[week][teacher] = {}
      if (!teacherEntriesByWeek[week][teacher][lesson.day]) teacherEntriesByWeek[week][teacher][lesson.day] = {}
      const normalizedRoom = room || ''
      const searchKey = buildSearchKey(
        `${teacher} ${lesson.subject || ''} ${groupName} ${activeSubgroups} ${normalizedRoom} ${lesson.day || ''} ${lesson.date || ''} ${lesson.comment || ''}`,
      )

      for (let pair = lesson.pair; pair < lesson.pair + duration; pair += 1) {
        if (!teacherEntriesByWeek[week][teacher][lesson.day][pair]) teacherEntriesByWeek[week][teacher][lesson.day][pair] = []
        teacherEntriesByWeek[week][teacher][lesson.day][pair].push({
          subject: lesson.subject || '',
          group: groupName,
          groupId: lesson.group,
          room: normalizedRoom,
          type: lesson.type,
          subgroup: activeSubgroups,
          time: PAIR_TIMES[pair] || '',
          pair,
          cancelled: Boolean(lesson.cancelled),
          course,
          searchKey,
          googleSheetId: lesson.google_sheet_id,
        })
      }
    }
  })

  const roomOccupancyByWeek: Record<number, RoomOccupancyIndex> = {}
  Object.keys(weeksByNumber).forEach((week) => {
    const weekNumber = Number(week)
    const roomMap = roomEntriesByWeek[weekNumber] || {}
    const index: RoomOccupancyIndex = {
      orderedRooms: [...allRooms],
      categoryByRoom: {},
      categoryStart: {},
      occupancy: {},
    }
    Object.entries(roomMap).forEach(([room, days]) => {
      index.occupancy[room] = {}
      Object.entries(days).forEach(([day, pairs]) => {
        index.occupancy[room][day] = {}
        Object.entries(pairs).forEach(([pair, entries]) => {
          index.occupancy[room][day][Number(pair)] = roomCell(entries, matrixSlotKey(room, day, Number(pair)))
        })
      })
    })
    finalizeRoomIndex(index)
    roomOccupancyByWeek[weekNumber] = index
  })

  const teacherOccupancyByWeek: Record<number, TeacherOccupancyIndex> = {}
  Object.entries(teacherEntriesByWeek).forEach(([week, teacherMap]) => {
    const index: TeacherOccupancyIndex = {
      orderedTeachers: Object.keys(teacherMap).sort((a, b) => a.localeCompare(b, 'ru')),
      occupancy: {},
      searchKeyByTeacher: {},
    }
    Object.entries(teacherMap).forEach(([teacher, days]) => {
      index.occupancy[teacher] = {}
      const teacherSearchParts = [teacher]
      Object.entries(days).forEach(([day, pairs]) => {
        index.occupancy[teacher][day] = {}
        Object.entries(pairs).forEach(([pair, entries]) => {
          index.occupancy[teacher][day][Number(pair)] = teacherCell(entries, matrixSlotKey(teacher, day, Number(pair)))
          entries.forEach((entry) => teacherSearchParts.push(entry.searchKey))
        })
      })
      index.searchKeyByTeacher[teacher] = buildSearchKey(teacherSearchParts.join(' '))
    })
    teacherOccupancyByWeek[Number(week)] = index
  })

  return {
    weeksByNumber,
    lessonsByWeek,
    lessonsByRoom,
    lessonsByTeacher,
    roomOccupancyByWeek,
    teacherOccupancyByWeek,
    groupNameById,
  }
}

async function stateFromCache(cached: CachedBundle, loading: boolean): Promise<ScheduleState> {
  if (cached.kind === 'single') {
    const index = await getIndexAsync(cached.schedule)
    return {
      schedule: cached.schedule,
      index,
      plan: cached.plan,
      plans: { [cached.schedule.course]: cached.plan },
      loading,
      error: null,
      loadedAt: cached.fetchedAt,
    }
  }

  const index = await getIndexAsync(cached.schedule)
  return {
    schedule: cached.schedule,
    index,
    plan: combinePlans(cached.plans),
    plans: cached.plans,
    loading,
    error: null,
    loadedAt: cached.fetchedAt,
  }
}

function createScheduleStore() {
  const store = writable<ScheduleState>(initialState)
  let currentCourse: CourseSelection = 'all'
  let inflight: AbortController | null = null
  let eventSource: EventSource | null = null
  let eventRefreshTimer: ReturnType<typeof setTimeout> | null = null

  function scheduleEventsUrl() {
    return `${API_BASE_URL}/api/v1/sse/schedule`
  }

  function parseScheduleEvent(event: MessageEvent) {
    try {
      return JSON.parse(event.data || '{}') as { type?: string; chunk?: { course?: number; week_number?: number } }
    } catch {
      return null
    }
  }

  function queueEventRefresh() {
    if (eventRefreshTimer) clearTimeout(eventRefreshTimer)
    eventRefreshTimer = setTimeout(() => {
      eventRefreshTimer = null
      void fetch(currentCourse, true)
    }, SSE_REFRESH_DEBOUNCE_MS)
  }

  function handleScheduleEvent(event: MessageEvent) {
    const payload = parseScheduleEvent(event)
    if (!payload || (payload.type && payload.type !== 'schedule_updated')) return
    const eventCourse = payload.chunk?.course
    if (eventCourse !== undefined && currentCourse !== 'all' && eventCourse !== currentCourse) return
    queueEventRefresh()
  }

  function connectScheduleEvents() {
    if (typeof EventSource === 'undefined') return
    if (eventSource) return

    eventSource = new EventSource(scheduleEventsUrl())
    eventSource.addEventListener('schedule_updated', handleScheduleEvent)
    eventSource.addEventListener('message', handleScheduleEvent)
    eventSource.onerror = () => {
      console.warn('SSE connection error, browser will retry automatically')
    }
  }

  async function fetch(course: CourseSelection, force = false) {
    currentCourse = course
    connectScheduleEvents()
    const cached = readCache(course)
    const isFresh = cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS

    if (cached) {
      const cachedState = await stateFromCache(cached, !isFresh || force)
      if (currentCourse !== course) return
      store.set(cachedState)
      if (isFresh && !force) return
    } else {
      store.update((state) => ({ ...state, loading: true, error: null }))
    }

    inflight?.abort()
    const controller = new AbortController()
    inflight = controller

    try {
      if (course === 'all') {
        const bundle = await loadAllCoursesBundle({ signal: controller.signal })
        if (controller.signal.aborted) return
        const index = await getIndexAsync(bundle.schedule)
        if (controller.signal.aborted) return
        cacheAll(bundle)
        store.set({
          schedule: bundle.schedule,
          index,
          plan: combinePlans(bundle.plans),
          plans: bundle.plans,
          loading: false,
          error: null,
          loadedAt: bundle.fetchedAt,
        })
      } else {
        const bundle = await loadCourseBundle(course, { signal: controller.signal })
        if (controller.signal.aborted) return
        const index = await getIndexAsync(bundle.schedule)
        if (controller.signal.aborted) return
        cacheCourse(course, bundle)
        store.set({
          schedule: bundle.schedule,
          index,
          plan: bundle.plan,
          plans: { [course]: bundle.plan },
          loading: false,
          error: null,
          loadedAt: bundle.fetchedAt,
        })
      }
    } catch (error) {
      if (controller.signal.aborted) return
      store.update((state) => ({
        ...state,
        loading: false,
        error: (error as Error).message,
        loadedAt: state.loadedAt || Date.now(),
      }))
    }
  }

  function refresh() {
    void fetch(currentCourse, true)
  }

  async function updatePlan(entry: CoursePlanEntry) {
    const key = planKey(entry.subject, entry.lesson_type, entry.group, entry.subgroup)
    const state = get(store)
    const previousPlans = state.plans
    const targetPlan = { ...(previousPlans[entry.course] || {}), [key]: entry.planned_pairs }
    const optimisticPlans = { ...previousPlans, [entry.course]: targetPlan }

    store.update((current) => ({
      ...current,
      plan: combinePlans(optimisticPlans),
      plans: optimisticPlans,
    }))

    try {
      await saveCoursePlanEntry(entry)
      const current = get(store)
      if (!current.schedule) return

      if (currentCourse === 'all') {
        cacheAll({
          schedule: current.schedule as MergedSchedule,
          plans: optimisticPlans,
          fetchedAt: current.loadedAt || Date.now(),
        })
      } else if (currentCourse === entry.course) {
        cacheCourse(entry.course, {
          schedule: current.schedule as CourseSchedule,
          plan: targetPlan,
          fetchedAt: current.loadedAt || Date.now(),
        })
      }
    } catch (error) {
      store.update((current) => ({
        ...current,
        plan: combinePlans(previousPlans),
        plans: previousPlans,
        error: (error as Error).message,
      }))
      throw error
    }
  }

  return {
    subscribe: store.subscribe,
    fetch,
    refresh,
    updatePlan,
  }
}

export const scheduleStore = createScheduleStore()
