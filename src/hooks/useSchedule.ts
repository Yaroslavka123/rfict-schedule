import { useCallback, useEffect, useRef, useState } from 'react'

import {
  loadCourseBundle,
  planKey,
  saveCoursePlanEntry,
  type CourseDataBundle,
} from '@/api/scheduleClient'
import type { CoursePlanEntry, CoursePlanMap, CourseSchedule } from '@/types/schedule'

const CACHE_VERSION = 'v1'
const CACHE_TTL_MS = 60_000

interface CachedBundle {
  v: typeof CACHE_VERSION
  schedule: CourseSchedule
  plan: CoursePlanMap
  fetchedAt: number
}

function cacheKey(course: number) {
  return `rfict-cache-${CACHE_VERSION}-course-${course}`
}

function readCache(course: number): CachedBundle | null {
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

function writeCache(course: number, bundle: CourseDataBundle) {
  try {
    const payload: CachedBundle = {
      v: CACHE_VERSION,
      schedule: bundle.schedule,
      plan: bundle.plan,
      fetchedAt: bundle.fetchedAt,
    }
    localStorage.setItem(cacheKey(course), JSON.stringify(payload))
  } catch {
    /* localStorage may be unavailable (private mode, quota) — ignore */
  }
}

interface ScheduleState {
  schedule: CourseSchedule | null
  plan: CoursePlanMap
  loading: boolean
  error: string | null
  loadedAt: number
}

const initialState: ScheduleState = {
  schedule: null,
  plan: {},
  loading: true,
  error: null,
  loadedAt: 0,
}

export function useCourseData(course: number, refreshKey: number) {
  const [state, setState] = useState<ScheduleState>(initialState)
  const inflight = useRef<AbortController | null>(null)

  useEffect(() => {
    const cached = readCache(course)
    const isFresh = cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS
    if (cached) {
      setState({
        schedule: cached.schedule,
        plan: cached.plan,
        loading: !isFresh,
        error: null,
        loadedAt: cached.fetchedAt,
      })
      if (isFresh && refreshKey === 0) return
    } else {
      setState((current) => ({ ...current, loading: true, error: null }))
    }

    if (inflight.current) inflight.current.abort()
    const controller = new AbortController()
    inflight.current = controller

    loadCourseBundle(course, { signal: controller.signal })
      .then((bundle) => {
        if (controller.signal.aborted) return
        writeCache(course, bundle)
        setState({
          schedule: bundle.schedule,
          plan: bundle.plan,
          loading: false,
          error: null,
          loadedAt: bundle.fetchedAt,
        })
      })
      .catch((error: Error) => {
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
      const previousPlan = state.plan
      const optimistic: CoursePlanMap = { ...previousPlan, [key]: entry.planned_pairs }
      setState((current) => ({ ...current, plan: optimistic }))
      try {
        await saveCoursePlanEntry(entry)
        if (state.schedule) {
          writeCache(course, {
            schedule: state.schedule,
            plan: optimistic,
            fetchedAt: state.loadedAt || Date.now(),
          })
        }
      } catch (error) {
        setState((current) => ({ ...current, plan: previousPlan, error: (error as Error).message }))
      }
    },
    [course, state.plan, state.schedule, state.loadedAt],
  )

  return {
    schedule: state.schedule,
    plan: state.plan,
    loading: state.loading,
    error: state.error,
    loadedAt: state.loadedAt,
    updatePlanEntry,
  }
}
