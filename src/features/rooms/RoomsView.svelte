<script lang="ts">
  import Card from '@/components/ui/Card.svelte'
  import { LESSON_TYPE_LABELS, PAIRS, PAIR_TIMES } from '@/lib/constants'
  import {
    categorizeRoom,
    getActiveSubgroupsForLesson,
    getGroupNameById,
    isLessonActiveForWeek,
    normalizeRoom,
  } from '@/lib/schedule'
  import { cn } from '@/lib/utils'
  import type { LessonType, ScheduleGroup, ScheduleGroupWithCourse, WeekSchedule } from '@/types/schedule'

  interface RoomsViewProps {
    weeks: WeekSchedule[]
    groups: (ScheduleGroup | ScheduleGroupWithCourse)[]
    selectedWeek: number
    onWeekChange: (week: number) => void
  }

  interface SlotEntry {
    subject: string
    teacher: string
    group: string
    groupId: string
    course?: number
    type: LessonType
    subgroup: string
    time: string
    pair: number
    cancelled: boolean
    room: string
  }

  interface TooltipPerSubject {
    subject: string
    teacher: string
    teacherCourses: number[]
    type: string
    time: string
    groups: { name: string; subgroup: string | null; course?: number }[]
    cancelled: boolean
  }

  type Category = 'lecture-hall' | 'computer' | 'regular'

  const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']
  const typeLegend: Array<{ type: LessonType; label: string }> = [
    { type: 'lecture', label: 'Лек' },
    { type: 'lab', label: 'Лаб' },
    { type: 'practice', label: 'Пр' },
    { type: 'seminar', label: 'Сем' },
    { type: 'curator_hour', label: 'Кур' },
  ]

  let { weeks, groups, selectedWeek, onWeekChange }: RoomsViewProps = $props()
  let tooltip = $state<{ x: number; y: number; entries: SlotEntry[] } | null>(null)

  let roomList = $derived(buildRoomList(weeks))
  let activeWeeks = $derived(getActiveWeeks(weeks, selectedWeek))
  let groupsById = $derived(new Map(groups.map((group) => [group.id, group as ScheduleGroupWithCourse])))
  let occupancy = $derived(buildOccupancy(activeWeeks, groups, groupsById))
  let availableWeeks = $derived(Array.from(new Set(weeks.map((week) => week.week_number))).sort((a, b) => a - b))
  let tooltipMerged = $derived(tooltip ? mergeTooltipEntries(tooltip.entries) : [])
  let tooltipRoom = $derived(tooltip?.entries[0]?.room || '')

  function getActiveWeeks(source: WeekSchedule[], selected: number) {
    if (!source.length) return []
    const target = source.filter((week) => week.week_number === selected)
    return target.length > 0 ? target : [source[source.length - 1]]
  }

  function showTooltip(event: MouseEvent, entries: SlotEntry[]) {
    tooltip = { x: event.clientX + 12, y: event.clientY + 12, entries }
  }

  function hideTooltip() {
    tooltip = null
  }

  function formatSubgroup(raw: string): string {
    const trimmed = raw.trim()
    if (!trimmed) return ''
    if (/\d/.test(trimmed)) {
      return trimmed
        .split(',')
        .map((part) => `${part.trim().replace(/\s+/g, '')} пг`)
        .join(', ')
    }
    return trimmed
  }

  function mergeTooltipEntries(entries: SlotEntry[]): TooltipPerSubject[] {
    const map = new Map<string, TooltipPerSubject>()
    entries.forEach((entry) => {
      const key = [entry.subject, entry.teacher, entry.type, entry.time, entry.cancelled].join('|')
      const current = map.get(key)
      if (current) {
        if (entry.group && !current.groups.some((group) => group.name === entry.group && group.subgroup === entry.subgroup)) {
          current.groups.push({ name: entry.group, subgroup: entry.subgroup || null, course: entry.course })
        }
        if (entry.course && !current.teacherCourses.includes(entry.course)) {
          current.teacherCourses.push(entry.course)
        }
        return
      }
      map.set(key, {
        subject: entry.subject,
        teacher: entry.teacher,
        teacherCourses: entry.course ? [entry.course] : [],
        type: entry.type,
        time: entry.time,
        groups: entry.group ? [{ name: entry.group, subgroup: entry.subgroup || null, course: entry.course }] : [],
        cancelled: entry.cancelled,
      })
    })
    map.forEach((entry) => entry.teacherCourses.sort((a, b) => a - b))
    return Array.from(map.values())
  }

  function shortenSubject(subject: string) {
    if (!subject) return 'Занято'
    return subject.length > 14 ? `${subject.slice(0, 13)}...` : subject
  }

  function numericRoomSort(a: string, b: string) {
    const numA = parseInt(a.replace(/\D+/g, ''), 10)
    const numB = parseInt(b.replace(/\D+/g, ''), 10)
    if (!Number.isNaN(numA) && !Number.isNaN(numB) && numA !== numB) return numA - numB
    return a.localeCompare(b, 'ru')
  }

  function buildRoomList(sourceWeeks: WeekSchedule[]) {
    const seen = new Set<string>()
    sourceWeeks.forEach((week) => {
      week.lessons.forEach((lesson) => {
        const room = normalizeRoom(lesson.room)
        if (room && room !== 'ДО') seen.add(room)
      })
    })

    const buckets: Record<Category, string[]> = { 'lecture-hall': [], computer: [], regular: [] }
    const categoryByRoom: Record<string, Category> = {}
    seen.forEach((room) => {
      const category = categorizeRoom(room).tone as Category
      buckets[category].push(room)
      categoryByRoom[room] = category
    })
    ;(Object.keys(buckets) as Category[]).forEach((key) => buckets[key].sort(numericRoomSort))

    const orderedRooms = [...buckets['lecture-hall'], ...buckets.computer, ...buckets.regular]
    const categoryStart: Record<string, boolean> = {}
    ;(['lecture-hall', 'computer', 'regular'] as const).forEach((category) => {
      const first = buckets[category][0]
      if (first) categoryStart[first] = true
    })
    return { orderedRooms, categoryByRoom, categoryStart }
  }

  function buildOccupancy(
    sourceWeeks: WeekSchedule[],
    sourceGroups: (ScheduleGroup | ScheduleGroupWithCourse)[],
    groupMap: Map<string, ScheduleGroupWithCourse>,
  ) {
    const result: Record<string, Record<string, Record<number, SlotEntry[]>>> = {}
    sourceWeeks.forEach((week) => {
      week.lessons.forEach((lesson) => {
        if (!isLessonActiveForWeek(lesson, week.week_number)) return
        const room = normalizeRoom(lesson.room)
        if (!room || room === 'ДО') return
        const groupName = getGroupNameById(sourceGroups, lesson.group)
        const activeSubgroups = getActiveSubgroupsForLesson(lesson, week.week_number)
        if (!result[room]) result[room] = {}
        const day = lesson.day
        if (!result[room][day]) result[room][day] = {}
        const duration = Math.max(lesson.duration || 1, 1)
        const courseNumber = lesson.course_number ?? groupMap.get(lesson.group)?.course
        for (let pair = lesson.pair; pair < lesson.pair + duration; pair += 1) {
          if (!result[room][day][pair]) result[room][day][pair] = []
          result[room][day][pair].push({
            subject: lesson.subject || '',
            teacher: lesson.teacher || '',
            group: groupName,
            groupId: lesson.group,
            course: courseNumber,
            type: lesson.type,
            subgroup: activeSubgroups.join(', '),
            time: PAIR_TIMES[pair] || '',
            pair,
            cancelled: Boolean(lesson.cancelled),
            room,
          })
        }
      })
    })
    return result
  }
</script>

{#if !activeWeeks.length || roomList.orderedRooms.length === 0}
  <Card contentClass="py-12 text-center text-muted-foreground">Кабинеты не найдены.</Card>
{:else}
  <div class="rooms-page">
    <div class="flex flex-wrap items-center gap-2">
      <div class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Неделя</div>
      <div class="flex flex-wrap gap-1">
        {#each availableWeeks as weekNumber (weekNumber)}
          <button
            type="button"
            class={cn(
              'rounded-md border px-2.5 py-1 text-xs font-semibold transition-colors duration-150',
              weekNumber === selectedWeek
                ? 'border-primary bg-primary/15 text-primary'
                : 'border-border bg-background text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground',
            )}
            onclick={() => onWeekChange(weekNumber)}
          >
            {weekNumber}-я
          </button>
        {/each}
      </div>
      <div class="ml-auto flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
        <span class="inline-flex items-center gap-1 rounded-full border border-border bg-card/40 px-1.5 py-0.5">
          <span class="h-1.5 w-1.5 rounded-full bg-amber-500"></span>
          Поточные
        </span>
        <span class="inline-flex items-center gap-1 rounded-full border border-border bg-card/40 px-1.5 py-0.5">
          <span class="h-1.5 w-1.5 rounded-full bg-sky-500"></span>
          Комп. классы
        </span>
        <span class="inline-flex items-center gap-1 rounded-full border border-border bg-card/40 px-1.5 py-0.5">
          <span class="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
          Кабинеты
        </span>
        <span class="h-3 w-px bg-border"></span>
        {#each typeLegend as item (item.type)}
          <span
            class={cn(
              'inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider',
              `slot-type-${item.type}`,
            )}
          >
            {item.label}
          </span>
        {/each}
      </div>
    </div>

    <div class="room-matrix-wrap">
      <table class="room-matrix" onmouseleave={hideTooltip}>
        <colgroup>
          <col style="width: 2rem" />
          <col style="width: 2rem" />
          {#each roomList.orderedRooms as room (room)}
            <col />
          {/each}
        </colgroup>
        <thead>
          <tr>
            <th class="th-day">Д</th>
            <th class="th-pair">П</th>
            {#each roomList.orderedRooms as room (room)}
              {@const category = roomList.categoryByRoom[room]}
              {@const start = roomList.categoryStart[room]}
              <th class={cn('th-room', `th-cat-${category}`, `cat-bg-${category}`, start && 'room-cat-start')} title={room}>
                {room}
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
                {#each roomList.orderedRooms as room (room)}
                  {@const entries = occupancy[room]?.[day]?.[pair] || []}
                  {@const category = roomList.categoryByRoom[room]}
                  {@const start = roomList.categoryStart[room]}
                  {#if entries.length === 0}
                    <td class={cn('slot-cell slot-free', `cat-bg-${category}`, start && 'room-cat-start')}></td>
                  {:else}
                    {@const allCancelled = entries.every((entry) => entry.cancelled)}
                    {@const types = Array.from(new Set(entries.map((entry) => entry.type)))}
                    {@const typeClass = allCancelled
                      ? 'slot-cancelled'
                      : types.length > 1
                        ? 'slot-type-multi'
                        : `slot-type-${types[0] || 'unknown'}`}
                    {@const first = entries[0]}
                    {@const groupSet = Array.from(new Set(entries.map((entry) => entry.group).filter(Boolean)))}
                    {@const teacherSet = Array.from(new Set(entries.map((entry) => entry.teacher).filter(Boolean)))}
                    <td
                      class={cn('slot-cell slot-busy', typeClass, start && 'room-cat-start')}
                      onmouseenter={(event) => showTooltip(event, entries)}
                      onmouseleave={hideTooltip}
                    >
                      <div class="slot-content">
                        <div class={cn('slot-main', allCancelled && 'line-through')}>{shortenSubject(first.subject)}</div>
                        {#if groupSet.length > 0}
                          <div class="slot-meta">{groupSet[0]}</div>
                        {/if}
                      </div>
                      {#if teacherSet.length > 1}
                        <span class="slot-badge slot-badge-teacher" title={`Преподавателей: ${teacherSet.length}`}>
                          {teacherSet.length}
                        </span>
                      {/if}
                      {#if groupSet.length > 1}
                        <span class="slot-badge slot-badge-group" title={`Групп: ${groupSet.length}`}>
                          {groupSet.length}
                        </span>
                      {/if}
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
        {#if tooltipRoom}
          <div class="mb-1 font-bold text-amber-500">Кабинет: {tooltipRoom}</div>
        {/if}
        {#each tooltipMerged as entry, idx (`${entry.subject}-${idx}`)}
          <div>
            {#if idx > 0}
              <hr class="my-1.5 border-border" />
            {/if}
            <div class={cn('font-bold', entry.cancelled ? 'text-red-500 line-through' : 'text-primary')}>
              {entry.subject || '—'}
            </div>
            <div class="text-muted-foreground">
              {entry.teacher || '—'}
              {#if entry.teacherCourses.length > 0}
                <span class="ml-1 text-amber-400"> · {entry.teacherCourses.map((course) => `${course} курс`).join(', ')}</span>
              {/if}
            </div>
            <div class="text-emerald-400">
              {#if entry.groups.length > 0}
                {#each entry.groups as group, index (`${group.name}-${group.subgroup}-${index}`)}
                  <div>
                    {group.name}{group.subgroup ? ` ${formatSubgroup(group.subgroup)}` : ''}
                  </div>
                {/each}
              {:else}
                —
              {/if}
            </div>
            {#if entry.type}
              <div class="text-purple-400">{LESSON_TYPE_LABELS[entry.type as LessonType] || entry.type}</div>
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
