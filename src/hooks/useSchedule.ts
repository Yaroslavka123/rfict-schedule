import { useCallback, useEffect, useState } from 'react'

import { loadCoursePlan, loadCourseSchedule, saveCoursePlanEntry } from '@/api/scheduleClient'
import type { CoursePlanEntry, CoursePlanMap, CourseSchedule, DataSource } from '@/types/schedule'

interface ScheduleState {
  schedule: CourseSchedule | null
  loading: boolean
  error: string | null
  loadedAt: number
}

export function useCourseSchedule(course: number, refreshKey: number) {
  const [state, setState] = useState<ScheduleState>({ schedule: null, loading: true, error: null, loadedAt: 0 })

  useEffect(() => {
    let active = true
    setState((current) => ({ ...current, loading: true, error: null }))

    loadCourseSchedule(course)
      .then((schedule) => {
        if (!active) return
        setState({ schedule, loading: false, error: null, loadedAt: Date.now() })
      })
      .catch((error: Error) => {
        if (!active) return
        setState({ schedule: null, loading: false, error: error.message, loadedAt: Date.now() })
      })

    return () => {
      active = false
    }
  }, [course, refreshKey])

  return state
}

interface PlanState {
  plan: CoursePlanMap
  source: DataSource | null
  loading: boolean
  error: string | null
}

export function useCoursePlan(course: number, refreshKey: number) {
  const [state, setState] = useState<PlanState>({ plan: {}, source: null, loading: true, error: null })

  useEffect(() => {
    let active = true
    setState((current) => ({ ...current, loading: true, error: null }))
    loadCoursePlan(course)
      .then((result) => {
        if (!active) return
        setState({ plan: result.plan, source: result.source, loading: false, error: null })
      })
      .catch((error: Error) => {
        if (!active) return
        setState({ plan: {}, source: null, loading: false, error: error.message })
      })
    return () => {
      active = false
    }
  }, [course, refreshKey])

  const updateEntry = useCallback(async (entry: CoursePlanEntry) => {
    const previous = state.plan
    setState((current) => ({
      ...current,
      plan: { ...current.plan, [entry.subject.trim().toLowerCase()]: entry.planned_pairs },
    }))
    try {
      const source = await saveCoursePlanEntry(entry)
      setState((current) => ({ ...current, source }))
    } catch (error) {
      setState((current) => ({ ...current, plan: previous, error: (error as Error).message }))
    }
  }, [state.plan])

  return { ...state, updateEntry }
}
