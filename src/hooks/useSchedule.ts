import { useEffect, useState } from 'react'

import { loadWeekSchedule } from '@/api/scheduleClient'
import type { DataSource, WeekSchedule } from '@/types/schedule'

interface ScheduleState {
  schedule: WeekSchedule | null
  source: DataSource | null
  loading: boolean
  error: string | null
}

export function useSchedule(course: number, week: number) {
  const [state, setState] = useState<ScheduleState>({ schedule: null, source: null, loading: true, error: null })

  useEffect(() => {
    let active = true
    setState((current) => ({ ...current, loading: true, error: null }))

    loadWeekSchedule(course, week)
      .then((result) => {
        if (!active) return
        setState({ schedule: result.schedule, source: result.source, loading: false, error: null })
      })
      .catch((error: Error) => {
        if (!active) return
        setState({ schedule: null, source: null, loading: false, error: error.message })
      })

    return () => {
      active = false
    }
  }, [course, week])

  return state
}
