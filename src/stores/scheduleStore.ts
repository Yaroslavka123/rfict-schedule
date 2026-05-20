import { get, writable } from 'svelte/store'

import {
  loadAllCoursesBundle,
  loadCourseBundle,
  planKey,
  saveCoursePlanEntry,
  type AllCoursesBundle,
  type CourseDataBundle,
} from '@/api/scheduleClient'
import type {
  CoursePlanEntry,
  CoursePlanMap,
  CourseSchedule,
  CourseSelection,
  MergedSchedule,
} from '@/types/schedule'

const CACHE_VERSION = 'v2'
const CACHE_TTL_MS = 60_000
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
  plan: CoursePlanMap
  plans: Record<number, CoursePlanMap>
  loading: boolean
  error: string | null
  loadedAt: number
}

const initialState: ScheduleState = {
  schedule: null,
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

function stateFromCache(cached: CachedBundle, loading: boolean): ScheduleState {
  if (cached.kind === 'single') {
    return {
      schedule: cached.schedule,
      plan: cached.plan,
      plans: { [cached.schedule.course]: cached.plan },
      loading,
      error: null,
      loadedAt: cached.fetchedAt,
    }
  }

  return {
    schedule: cached.schedule,
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
    const key = planKey(entry.subject)
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
