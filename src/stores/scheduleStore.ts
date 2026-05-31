import { get, writable } from 'svelte/store'

import {
  loadAllCoursesBundle,
  loadCourseBundle,
  planKey,
  saveCoursePlanEntry,
  type AllCoursesBundle,
  type CourseDataBundle,
} from '@/api/scheduleClient'
import { PAIR_TIMES } from '@/lib/constants'
import {
  categorizeRoom,
  getActiveSubgroupsForLesson,
  isLessonActiveForWeek,
  normalizeRoom,
  normalizeTeacherName,
} from '@/lib/schedule'
import { normalizeText } from '@/lib/utils'
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
}

export interface RoomCell {
  entries: RoomSlotEntry[]
  allCancelled: boolean
  types: LessonType[]
  groups: string[]
  teachers: string[]
  first: RoomSlotEntry
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
}

export interface TeacherCell {
  entries: TeacherSlotEntry[]
  allCancelled: boolean
  types: LessonType[]
  rooms: string[]
}

export interface TeacherOccupancyIndex {
  orderedTeachers: string[]
  occupancy: Record<string, Record<string, Record<number, TeacherCell>>>
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
const writeTimers = new Map<string, ReturnType<typeof setTimeout>>()

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

function roomCell(entries: RoomSlotEntry[]): RoomCell {
  const groups = Array.from(new Set(entries.map((entry) => entry.group).filter(Boolean)))
  const teachers = Array.from(new Set(entries.map((entry) => entry.teacher).filter(Boolean)))
  const types = Array.from(new Set(entries.map((entry) => entry.type)))
  return {
    entries,
    allCancelled: entries.every((entry) => entry.cancelled),
    types,
    groups,
    teachers,
    first: entries[0],
  }
}

function teacherCell(entries: TeacherSlotEntry[]): TeacherCell {
  const rooms = Array.from(new Set(entries.map((entry) => entry.room).filter(Boolean)))
  const types = Array.from(new Set(entries.map((entry) => entry.type)))
  return {
    entries,
    allCancelled: entries.every((entry) => entry.cancelled),
    types,
    rooms,
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

function buildScheduleIndex(schedule: CourseSchedule | MergedSchedule | null): ScheduleIndex {
  if (!schedule) return emptyIndex
  const weeksByNumber: Record<number, WeekSchedule[]> = {}
  const lessonsByWeek: Record<number, ScheduleLesson[]> = {}
  const lessonsByRoom: Record<string, ScheduleLesson[]> = {}
  const lessonsByTeacher: Record<string, ScheduleLesson[]> = {}
  const roomEntriesByWeek: Record<number, Record<string, Record<string, Record<number, RoomSlotEntry[]>>>> = {}
  const teacherEntriesByWeek: Record<number, Record<string, Record<string, Record<number, TeacherSlotEntry[]>>>> = {}
  const { groupNameById, groupNameByCourseAndId, groupCourseById } = buildGroupMaps(schedule)
  const fallbackCourse = getScheduleCourse(schedule)

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

      for (let pair = lesson.pair; pair < lesson.pair + duration; pair += 1) {
        const searchKey = normalizeText(
          `${room} ${lesson.subject || ''} ${teacher} ${groupName} ${activeSubgroups} ${lesson.day || ''} ${lesson.date || ''} ${lesson.comment || ''}`,
        )
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
        })
      }
    }

    if (teacher) {
      if (!teacherEntriesByWeek[week]) teacherEntriesByWeek[week] = {}
      if (!teacherEntriesByWeek[week][teacher]) teacherEntriesByWeek[week][teacher] = {}
      if (!teacherEntriesByWeek[week][teacher][lesson.day]) teacherEntriesByWeek[week][teacher][lesson.day] = {}

      for (let pair = lesson.pair; pair < lesson.pair + duration; pair += 1) {
        const normalizedRoom = room || ''
        const searchKey = normalizeText(
          `${teacher} ${lesson.subject || ''} ${groupName} ${activeSubgroups} ${normalizedRoom} ${lesson.day || ''} ${lesson.date || ''} ${lesson.comment || ''}`,
        )
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
        })
      }
    }
  })

  const roomOccupancyByWeek: Record<number, RoomOccupancyIndex> = {}
  Object.entries(roomEntriesByWeek).forEach(([week, roomMap]) => {
    const index: RoomOccupancyIndex = {
      orderedRooms: Object.keys(roomMap),
      categoryByRoom: {},
      categoryStart: {},
      occupancy: {},
    }
    Object.entries(roomMap).forEach(([room, days]) => {
      index.occupancy[room] = {}
      Object.entries(days).forEach(([day, pairs]) => {
        index.occupancy[room][day] = {}
        Object.entries(pairs).forEach(([pair, entries]) => {
          index.occupancy[room][day][Number(pair)] = roomCell(entries)
        })
      })
    })
    finalizeRoomIndex(index)
    roomOccupancyByWeek[Number(week)] = index
  })

  const teacherOccupancyByWeek: Record<number, TeacherOccupancyIndex> = {}
  Object.entries(teacherEntriesByWeek).forEach(([week, teacherMap]) => {
    const index: TeacherOccupancyIndex = {
      orderedTeachers: Object.keys(teacherMap).sort((a, b) => a.localeCompare(b, 'ru')),
      occupancy: {},
    }
    Object.entries(teacherMap).forEach(([teacher, days]) => {
      index.occupancy[teacher] = {}
      Object.entries(days).forEach(([day, pairs]) => {
        index.occupancy[teacher][day] = {}
        Object.entries(pairs).forEach(([pair, entries]) => {
          index.occupancy[teacher][day][Number(pair)] = teacherCell(entries)
        })
      })
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

function stateFromCache(cached: CachedBundle, loading: boolean): ScheduleState {
  if (cached.kind === 'single') {
    return {
      schedule: cached.schedule,
      index: buildScheduleIndex(cached.schedule),
      plan: cached.plan,
      plans: { [cached.schedule.course]: cached.plan },
      loading,
      error: null,
      loadedAt: cached.fetchedAt,
    }
  }

  return {
    schedule: cached.schedule,
    index: buildScheduleIndex(cached.schedule),
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

  async function fetch(course: CourseSelection, force = false) {
    currentCourse = course
    const cached = readCache(course)
    const isFresh = cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS

    if (cached) {
      store.set(stateFromCache(cached, !isFresh || force))
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
        cacheAll(bundle)
        store.set({
          schedule: bundle.schedule,
          index: buildScheduleIndex(bundle.schedule),
          plan: combinePlans(bundle.plans),
          plans: bundle.plans,
          loading: false,
          error: null,
          loadedAt: bundle.fetchedAt,
        })
      } else {
        const bundle = await loadCourseBundle(course, { signal: controller.signal })
        if (controller.signal.aborted) return
        cacheCourse(course, bundle)
        store.set({
          schedule: bundle.schedule,
          index: buildScheduleIndex(bundle.schedule),
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
    const key = planKey(entry.subject, entry.lesson_type)
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
