import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

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

function cacheKey(course: CourseSelection) {
  return `rfict-cache-${CACHE_VERSION}-course-${course === 'all' ? 'all' : course}`
}

function readCache(course: CourseSelection): CachedBundle | null {
  try {
    const raw = localStorage.getItem(cacheKey(course))
    if (!raw) return null
    const parsed = JSON.parse(raw) as CachedBundle
    if (parsed.v !== CACHE_VERSION) return null
    return parsed
  } catch {
    return null
  }
}

function writeCacheCourse(course: number, bundle: CourseDataBundle) {
  try {
    const payload: CachedCourse = {
      v: CACHE_VERSION,
      kind: 'single',
      schedule: bundle.schedule,
      plan: bundle.plan,
      fetchedAt: bundle.fetchedAt,
    }
    localStorage.setItem(cacheKey(course), JSON.stringify(payload))
  } catch {
    /* ignore */
  }
}

function writeCacheAll(bundle: AllCoursesBundle) {
  try {
    const payload: CachedAll = {
      v: CACHE_VERSION,
      kind: 'all',
      schedule: bundle.schedule,
      plans: bundle.plans,
      fetchedAt: bundle.fetchedAt,
    }
    localStorage.setItem(cacheKey('all'), JSON.stringify(payload))
  } catch {
    /* ignore */
  }
}

interface ScheduleState {
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

function combinePlans(plans: Record<number, CoursePlanMap>): CoursePlanMap {
  const merged: CoursePlanMap = {}
  Object.values(plans).forEach((map) => {
    Object.entries(map).forEach(([k, v]) => {
      if (merged[k] === undefined) merged[k] = v
    })
  })
  return merged
}

export function useCourseData(course: CourseSelection, refreshKey: number) {
  const [state, setState] = useState<ScheduleState>(initialState)
  const inflight = useRef<AbortController | null>(null)

  useEffect(() => {
    const cached = readCache(course)
    const isFresh = cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS
    if (cached) {
      if (cached.kind === 'single') {
        setState({
          schedule: cached.schedule,
          plan: cached.plan,
          plans: { [cached.schedule.course]: cached.plan },
          loading: !isFresh,
          error: null,
          loadedAt: cached.fetchedAt,
        })
      } else {
        setState({
          schedule: cached.schedule,
          plan: combinePlans(cached.plans),
          plans: cached.plans,
          loading: !isFresh,
          error: null,
          loadedAt: cached.fetchedAt,
        })
      }
      if (isFresh && refreshKey === 0) return
    } else {
      setState((current) => ({ ...current, loading: true, error: null }))
    }

    if (inflight.current) inflight.current.abort()
    const controller = new AbortController()
    inflight.current = controller

    const promise =
      course === 'all'
        ? loadAllCoursesBundle({ signal: controller.signal }).then((bundle) => {
            if (controller.signal.aborted) return
            writeCacheAll(bundle)
            setState({
              schedule: bundle.schedule,
              plan: combinePlans(bundle.plans),
              plans: bundle.plans,
              loading: false,
              error: null,
              loadedAt: bundle.fetchedAt,
            })
          })
        : loadCourseBundle(course, { signal: controller.signal }).then((bundle) => {
            if (controller.signal.aborted) return
            writeCacheCourse(course, bundle)
            setState({
              schedule: bundle.schedule,
              plan: bundle.plan,
              plans: { [course]: bundle.plan },
              loading: false,
              error: null,
              loadedAt: bundle.fetchedAt,
            })
          })

    promise.catch((error: Error) => {
      if (controller.signal.aborted) return
      setState((current) => ({
        ...current,
        loading: false,
        error: error.message,
        loadedAt: current.loadedAt || Date.now(),
      }))
    })

    return () => {
      controller.abort()
    }
  }, [course, refreshKey])

  const updatePlanEntry = useCallback(
    async (entry: CoursePlanEntry) => {
      const key = planKey(entry.subject)
      const previousPlans = state.plans
      const targetCourse = entry.course
      const targetPlan = { ...(previousPlans[targetCourse] || {}), [key]: entry.planned_pairs }
      const optimisticPlans = { ...previousPlans, [targetCourse]: targetPlan }
      const optimisticFlat = combinePlans(optimisticPlans)
      setState((current) => ({ ...current, plan: optimisticFlat, plans: optimisticPlans }))
      try {
        await saveCoursePlanEntry(entry)
        if (state.schedule) {
          if (course === 'all') {
            writeCacheAll({
              schedule: state.schedule as MergedSchedule,
              plans: optimisticPlans,
              fetchedAt: state.loadedAt || Date.now(),
            })
          } else if (course === targetCourse) {
            writeCacheCourse(course, {
              schedule: state.schedule as CourseSchedule,
              plan: targetPlan,
              fetchedAt: state.loadedAt || Date.now(),
            })
          }
        }
      } catch (error) {
        setState((current) => ({
          ...current,
          plan: combinePlans(previousPlans),
          plans: previousPlans,
          error: (error as Error).message,
        }))
      }
    },
    [course, state.plans, state.schedule, state.loadedAt],
  )

  const result = useMemo(
    () => ({
      schedule: state.schedule,
      plan: state.plan,
      plans: state.plans,
      loading: state.loading,
      error: state.error,
      loadedAt: state.loadedAt,
      updatePlanEntry,
    }),
    [state, updatePlanEntry],
  )

  return result
}
