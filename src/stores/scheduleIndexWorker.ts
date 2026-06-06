import { buildScheduleIndex, type ScheduleIndex } from '@/stores/scheduleStore'
import type { CourseSchedule, MergedSchedule } from '@/types/schedule'

type ScheduleIndexWorkerRequest = {
  id: number
  schedule: CourseSchedule | MergedSchedule
}

type ScheduleIndexWorkerResponse = {
  id: number
  index: ScheduleIndex
}

self.onmessage = (event: MessageEvent<ScheduleIndexWorkerRequest>) => {
  const { id, schedule } = event.data
  const response: ScheduleIndexWorkerResponse = {
    id,
    index: buildScheduleIndex(schedule),
  }
  self.postMessage(response)
}
