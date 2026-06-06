<script lang="ts">
  import MatrixView from '@/features/matrix/MatrixView.svelte'
  import { roomMatrixAdapter } from '@/features/matrix/RoomAdapter'
  import type { RoomOccupancyIndex } from '@/stores/scheduleStore'
  import type { LessonType } from '@/types/schedule'

  interface RoomsViewProps {
    active: boolean
    roomData: RoomOccupancyIndex | null
    groupFilter: string
    search: string
    lessonTypes: LessonType[]
  }

  let { active, roomData, groupFilter, search, lessonTypes }: RoomsViewProps = $props()
</script>

<MatrixView
  {active}
  source={roomData}
  {groupFilter}
  {search}
  {lessonTypes}
  adapter={roomMatrixAdapter}
/>
