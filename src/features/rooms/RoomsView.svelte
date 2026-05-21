<script lang="ts">
  import Card from '@/components/ui/Card.svelte'
  import { LESSON_TYPE_LABELS, PAIRS, PAIR_TIMES } from '@/lib/constants'
  import { cn, normalizeText } from '@/lib/utils'
  import type { RoomCell, RoomCategory, RoomOccupancyIndex, RoomSlotEntry } from '@/stores/scheduleStore'
  import type { LessonType } from '@/types/schedule'

  interface RoomsViewProps {
    roomData: RoomOccupancyIndex | null
    groupFilter: string
    search: string
    lessonTypes: LessonType[]
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

  const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']
  const typeLegend: Array<{ type: LessonType; label: string }> = [
    { type: 'lecture', label: 'Лек' },
    { type: 'lab', label: 'Лаб' },
    { type: 'practice', label: 'Пр' },
    { type: 'seminar', label: 'Сем' },
    { type: 'curator_hour', label: 'Кур' },
  ]

  let { roomData, groupFilter, search, lessonTypes }: RoomsViewProps = $props()
  let tooltip = $state<{ x: number; y: number; entries: RoomSlotEntry[] } | null>(null)
  let tooltipKey = $state<string | null>(null)

  let normalizedSearch = $derived(normalizeText(search))
  let filteredRoomData = $derived(filterRoomData(roomData, groupFilter, normalizedSearch, lessonTypes))
  let orderedRooms = $derived(filteredRoomData?.orderedRooms || [])
  let categoryByRoom = $derived(filteredRoomData?.categoryByRoom || {})
  let categoryStart = $derived(filteredRoomData?.categoryStart || {})
  let occupancy = $derived(filteredRoomData?.occupancy || {})
  let tooltipEntriesByKey = $derived(buildTooltipEntriesByKey(orderedRooms, occupancy))
  let tooltipMerged = $derived(tooltip ? mergeTooltipEntries(tooltip.entries) : [])
  let tooltipRoom = $derived(tooltip?.entries[0]?.room || '')

  function slotKey(room: string, day: string, pair: number) {
    return `${encodeURIComponent(room)}|${day}|${pair}`
  }

  function buildTooltipEntriesByKey(
    rooms: string[],
    source: RoomOccupancyIndex['occupancy'],
  ) {
    const map = new Map<string, RoomSlotEntry[]>()
    rooms.forEach((room) => {
      DAYS.forEach((day) => {
        PAIRS.forEach((pair) => {
          const entries = source[room]?.[day]?.[pair]?.entries
          if (entries?.length) map.set(slotKey(room, day, pair), entries)
        })
      })
    })
    return map
  }

  function showTooltip(event: MouseEvent, entries: RoomSlotEntry[], key: string) {
    tooltipKey = key
    tooltip = {
      x: Math.max(8, Math.min(event.clientX + 12, window.innerWidth - 340)),
      y: Math.max(8, Math.min(event.clientY + 12, window.innerHeight - 260)),
      entries,
    }
  }

  function hideTooltip() {
    tooltipKey = null
    tooltip = null
  }

  function handleTableHover(event: MouseEvent) {
    const cell = (event.target as HTMLElement).closest('td[data-slot-key]') as HTMLTableCellElement | null
    if (!cell || !(event.currentTarget as HTMLElement).contains(cell)) {
      hideTooltip()
      return
    }
    const key = cell.dataset.slotKey
    if (!key || key === tooltipKey) return
    const entries = tooltipEntriesByKey.get(key)
    if (entries?.length) showTooltip(event, entries, key)
    else hideTooltip()
  }

  function entryMatches(entry: RoomSlotEntry, activeGroup: string, query: string, types: LessonType[]) {
    if (activeGroup !== 'all' && entry.groupId !== activeGroup) return false
    if (types.length > 0 && !types.includes(entry.type)) return false
    return !query || entry.searchKey.includes(query)
  }

  function summarizeRoomEntries(entries: RoomSlotEntry[]): RoomCell {
    return {
      entries,
      allCancelled: entries.every((entry) => entry.cancelled),
      types: Array.from(new Set(entries.map((entry) => entry.type))),
      groups: Array.from(new Set(entries.map((entry) => entry.group).filter(Boolean))),
      teachers: Array.from(new Set(entries.map((entry) => entry.teacher).filter(Boolean))),
      first: entries[0],
    }
  }

  function filteredCategoryStart(source: RoomOccupancyIndex, rooms: string[]) {
    const result: Record<string, boolean> = {}
    const seen = new Set<RoomCategory>()
    rooms.forEach((room) => {
      const category = source.categoryByRoom[room]
      result[room] = !seen.has(category)
      seen.add(category)
    })
    return result
  }

  function filterRoomData(
    source: RoomOccupancyIndex | null,
    activeGroup: string,
    query: string,
    types: LessonType[],
  ): RoomOccupancyIndex | null {
    if (!source) return null
    if (activeGroup === 'all' && !query && types.length === 0) return source

    const occupancy: RoomOccupancyIndex['occupancy'] = {}
    const orderedRooms: string[] = []

    source.orderedRooms.forEach((room) => {
      let hasRoomEntries = false
      DAYS.forEach((day) => {
        PAIRS.forEach((pair) => {
          const cell = source.occupancy[room]?.[day]?.[pair]
          if (!cell) return
          const entries = cell.entries.filter((entry) => entryMatches(entry, activeGroup, query, types))
          if (entries.length === 0) return
          if (!occupancy[room]) occupancy[room] = {}
          if (!occupancy[room][day]) occupancy[room][day] = {}
          occupancy[room][day][pair] = summarizeRoomEntries(entries)
          hasRoomEntries = true
        })
      })
      if (hasRoomEntries) orderedRooms.push(room)
    })

    return {
      orderedRooms,
      categoryByRoom: source.categoryByRoom,
      categoryStart: filteredCategoryStart(source, orderedRooms),
      occupancy,
    }
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

  function mergeTooltipEntries(entries: RoomSlotEntry[]): TooltipPerSubject[] {
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
</script>

{#if orderedRooms.length === 0}
  <Card contentClass="py-12 text-center text-muted-foreground">Кабинеты не найдены.</Card>
{:else}
  <div class="rooms-page">
    <div class="flex flex-wrap items-center gap-2">
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
      <table class="room-matrix" onpointerover={handleTableHover} onmouseleave={hideTooltip}>
        <colgroup>
          <col style="width: 2rem" />
          <col style="width: 2rem" />
          {#each orderedRooms as room (room)}
            <col />
          {/each}
        </colgroup>
        <thead>
          <tr>
            <th class="th-day">Д</th>
            <th class="th-pair">П</th>
            {#each orderedRooms as room (room)}
              {@const category = categoryByRoom[room]}
              {@const start = categoryStart[room]}
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
                {#each orderedRooms as room (room)}
                  {@const cell = occupancy[room]?.[day]?.[pair]}
                  {@const category = categoryByRoom[room]}
                  {@const start = categoryStart[room]}
                  {#if !cell}
                    <td class={cn('slot-cell slot-free', `cat-bg-${category}`, start && 'room-cat-start')}></td>
                  {:else}
                    {@const typeClass = cell.allCancelled
                      ? 'slot-cancelled'
                      : cell.types.length > 1
                        ? 'slot-type-multi'
                        : `slot-type-${cell.types[0] || 'unknown'}`}
                    <td
                      class={cn('slot-cell slot-busy', typeClass, start && 'room-cat-start')}
                      data-slot-key={slotKey(room, day, pair)}
                    >
                      <div class="slot-content">
                        <div class={cn('slot-main', cell.allCancelled && 'line-through')}>{shortenSubject(cell.first.subject)}</div>
                        {#if cell.groups.length > 0}
                          <div class="slot-meta">{cell.groups[0]}</div>
                        {/if}
                      </div>
                      {#if cell.teachers.length > 1}
                        <span class="slot-badge slot-badge-teacher" title={`Преподавателей: ${cell.teachers.length}`}>
                          {cell.teachers.length}
                        </span>
                      {/if}
                      {#if cell.groups.length > 1}
                        <span class="slot-badge slot-badge-group" title={`Групп: ${cell.groups.length}`}>
                          {cell.groups.length}
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
