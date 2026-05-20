<script lang="ts">
  import Card from '@/components/ui/Card.svelte'
  import { LESSON_TYPE_LABELS, PAIRS, PAIR_TIMES } from '@/lib/constants'
  import { getGroupNameById, normalizeRoom, normalizeTeacherName } from '@/lib/schedule'
  import { cn, normalizeText } from '@/lib/utils'
  import type { LessonType, ScheduleGroup, ScheduleGroupWithCourse, ScheduleLesson } from '@/types/schedule'

  interface TeachersViewProps {
    lessons: ScheduleLesson[]
    groups: (ScheduleGroup | ScheduleGroupWithCourse)[]
    search: string
    lessonTypes: LessonType[]
  }

  interface TeacherSlot {
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
  }

  const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']

  let { lessons, groups, search, lessonTypes }: TeachersViewProps = $props()
  let tooltip = $state<{ x: number; y: number; entries: TeacherSlot[]; teacher: string } | null>(null)

  let teacherData = $derived(buildTeacherOccupancy(lessons, groups))
  let normalizedSearch = $derived(normalizeText(search.trim()))
  let teacherMatch = $derived(buildTeacherMatch(teacherData.orderedTeachers, normalizedSearch))

  function buildTeacherMatch(teachers: string[], query: string) {
    if (!query) return null
    const matches = new Set<string>()
    teachers.forEach((teacher) => {
      if (normalizeText(teacher).includes(query)) matches.add(teacher)
    })
    return matches
  }

  function showTooltip(event: MouseEvent, entries: TeacherSlot[], teacher: string) {
    tooltip = { x: event.clientX + 12, y: event.clientY + 12, entries, teacher }
  }

  function hideTooltip() {
    tooltip = null
  }

  function formatSubgroup(raw: string): string {
    const trimmed = raw.trim()
    if (!trimmed) return ''
    if (/\d/.test(trimmed)) return `${trimmed.replace(/\s+/g, '')} пг`
    return trimmed
  }

  function shortTeacherName(full: string): string {
    const trimmed = full.trim()
    if (trimmed.length <= 22) return trimmed
    return `${trimmed.slice(0, 21)}...`
  }

  function buildTeacherOccupancy(
    sourceLessons: ScheduleLesson[],
    sourceGroups: (ScheduleGroup | ScheduleGroupWithCourse)[],
  ) {
    const occupancy: Record<string, Record<string, Record<number, TeacherSlot[]>>> = {}
    const groupsById = new Map<string, ScheduleGroupWithCourse>()
    sourceGroups.forEach((group) => groupsById.set(group.id, group as ScheduleGroupWithCourse))

    sourceLessons.forEach((lesson) => {
      const teacher = normalizeTeacherName(lesson.teacher || '')
      if (!teacher) return
      if (!occupancy[teacher]) occupancy[teacher] = {}
      const day = lesson.day
      if (!occupancy[teacher][day]) occupancy[teacher][day] = {}
      const duration = Math.max(lesson.duration || 1, 1)
      const courseNumber = lesson.course_number ?? groupsById.get(lesson.group)?.course
      const groupName = getGroupNameById(sourceGroups, lesson.group)
      for (let pair = lesson.pair; pair < lesson.pair + duration; pair += 1) {
        if (!occupancy[teacher][day][pair]) occupancy[teacher][day][pair] = []
        occupancy[teacher][day][pair].push({
          subject: lesson.subject || '',
          group: groupName,
          groupId: lesson.group,
          room: normalizeRoom(lesson.room) || '',
          type: lesson.type,
          subgroup: lesson.subgroup || '',
          time: PAIR_TIMES[pair] || '',
          pair,
          cancelled: Boolean(lesson.cancelled),
          course: courseNumber,
        })
      }
    })

    const orderedTeachers = Object.keys(occupancy).sort((a, b) => a.localeCompare(b, 'ru'))
    return { occupancy, orderedTeachers }
  }
</script>

{#if teacherData.orderedTeachers.length === 0}
  <Card contentClass="py-12 text-center text-muted-foreground">Преподаватели не найдены.</Card>
{:else}
  <div class="teachers-page">
    <div class="teachers-matrix-wrap">
      <table class="teachers-matrix" onmouseleave={hideTooltip}>
        <colgroup>
          <col style="width: 2rem" />
          <col style="width: 2rem" />
          {#each teacherData.orderedTeachers as teacher (teacher)}
            <col />
          {/each}
        </colgroup>
        <thead>
          <tr>
            <th class="th-day">Д</th>
            <th class="th-pair">П</th>
            {#each teacherData.orderedTeachers as teacher (teacher)}
              {@const isMatch = teacherMatch?.has(teacher)}
              {@const isDim = teacherMatch && !isMatch}
              <th class={cn('th-teacher', isMatch && 'th-teacher-match', isDim && 'th-teacher-dim')} title={teacher}>
                <div class="th-teacher-label">{shortTeacherName(teacher)}</div>
              </th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each DAYS as day, dayIndex (day)}
            {#each PAIRS as pair (pair)}
              <tr class={pair === 1 && dayIndex > 0 ? 'day-separator' : ''}>
                {#if pair === 1}
                  <td class="td-day" rowspan="8">{day}</td>
                {/if}
                <td class="td-pair" title={PAIR_TIMES[pair]}>{pair}</td>
                {#each teacherData.orderedTeachers as teacher (teacher)}
                  {@const entries = teacherData.occupancy[teacher]?.[day]?.[pair] || []}
                  {@const filtered = lessonTypes.length > 0 ? entries.filter((entry) => lessonTypes.includes(entry.type)) : entries}
                  {@const isMatch = teacherMatch?.has(teacher)}
                  {@const isDim = teacherMatch && !isMatch}
                  {#if filtered.length === 0}
                    <td class={cn('slot-cell slot-free', isDim && 'slot-dim')}></td>
                  {:else}
                    {@const allCancelled = filtered.every((entry) => entry.cancelled)}
                    {@const types = Array.from(new Set(filtered.map((entry) => entry.type)))}
                    {@const typeClass = allCancelled
                      ? 'slot-cancelled'
                      : types.length > 1
                        ? 'slot-type-multi'
                        : `slot-type-${types[0] || 'unknown'}`}
                    {@const rooms = Array.from(new Set(filtered.map((entry) => entry.room).filter(Boolean)))}
                    <td
                      class={cn('slot-cell slot-busy', typeClass, isMatch && 'slot-match', isDim && 'slot-dim')}
                      onmouseenter={(event) => showTooltip(event, filtered, teacher)}
                      onmouseleave={hideTooltip}
                    >
                      <div class={cn('slot-content', allCancelled && 'line-through')}>
                        <div class="slot-main">{rooms[0] || '—'}</div>
                        {#if rooms.length > 1}
                          <span class="slot-badge slot-badge-group" title={`Кабинетов: ${rooms.length}`}>
                            {rooms.length}
                          </span>
                        {/if}
                      </div>
                    </td>
                  {/if}
                {/each}
              </tr>
            {/each}
          {/each}
        </tbody>
      </table>
    </div>

    {#if tooltip}
      <div
        class="slot-tooltip pointer-events-none fixed z-50 max-w-xs rounded-lg border border-border px-3 py-2 text-xs shadow-xl"
        style={`left: ${tooltip.x}px; top: ${tooltip.y}px`}
      >
        <div class="mb-1 font-bold text-primary">{tooltip.teacher || '—'}</div>
        {#each tooltip.entries as entry, idx (idx)}
          <div>
            {#if idx > 0}
              <hr class="my-1.5 border-border" />
            {/if}
            <div class={cn('font-semibold', entry.cancelled ? 'text-red-500 line-through' : 'text-amber-400')}>
              {entry.subject || '—'}
            </div>
            <div class="text-emerald-400">Кабинет: {entry.room || '—'}</div>
            <div class="text-emerald-400">
              {entry.group || '—'}{entry.subgroup ? ` · ${formatSubgroup(entry.subgroup)}` : ''}{entry.course ? ` · ${entry.course} курс` : ''}
            </div>
            {#if entry.type}
              <div class="text-purple-400">{LESSON_TYPE_LABELS[entry.type] || entry.type}</div>
            {/if}
            {#if entry.time}
              <div class="text-muted-foreground">{entry.time}</div>
            {/if}
            {#if entry.cancelled}
              <div class="font-semibold text-red-500">Пара отменена</div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </div>
{/if}
