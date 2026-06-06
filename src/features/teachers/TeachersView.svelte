<script lang="ts">
  import MatrixView from '@/features/matrix/MatrixView.svelte'
  import { teacherMatrixAdapter } from '@/features/matrix/TeacherAdapter'
  import type { TeacherOccupancyIndex } from '@/stores/scheduleStore'
  import type { LessonType } from '@/types/schedule'

  interface TeachersViewProps {
    active: boolean
    teacherData: TeacherOccupancyIndex | null
    groupFilter: string
    search: string
    lessonTypes: LessonType[]
  }

  let { active, teacherData, groupFilter, search, lessonTypes }: TeachersViewProps = $props()
</script>

<MatrixView
  {active}
  source={teacherData}
  {groupFilter}
  {search}
  {lessonTypes}
  adapter={teacherMatrixAdapter}
/>
