import {
  filterRoomMatrix,
  filterTeacherMatrix,
  type RoomMatrixFilterResult,
  type TeacherMatrixFilterResult,
} from '@/features/matrix/matrixFilter'
import type { RoomOccupancyIndex, TeacherOccupancyIndex } from '@/stores/scheduleStore'
import type { LessonType } from '@/types/schedule'

type WorkerRequest =
  | { type: 'set-rooms-source'; source: RoomOccupancyIndex | null }
  | { type: 'set-teachers-source'; source: TeacherOccupancyIndex | null }
  | { type: 'run-rooms'; id: number; activeGroup: string; query: string; types: LessonType[] }
  | { type: 'run-teachers'; id: number; activeGroup: string; query: string; types: LessonType[] }

type WorkerResponse =
  | ({ type: 'rooms-result'; id: number } & RoomMatrixFilterResult)
  | ({ type: 'teachers-result'; id: number } & TeacherMatrixFilterResult)

let roomsSource: RoomOccupancyIndex | null = null
let teachersSource: TeacherOccupancyIndex | null = null

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
    post({
      type: 'rooms-result',
      id: message.id,
      ...filterRoomMatrix(roomsSource, message.activeGroup, message.query, message.types),
    })
    return
  }

  if (message.type === 'run-teachers') {
    post({
      type: 'teachers-result',
      id: message.id,
      ...filterTeacherMatrix(teachersSource, message.activeGroup, message.query, message.types),
    })
  }
}
