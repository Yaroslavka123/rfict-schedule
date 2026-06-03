<script lang="ts">
  import { Plus, Trash2 } from '@lucide/svelte'

  import Card from '@/components/ui/Card.svelte'
  import Button from '@/components/ui/Button.svelte'
  import { LESSON_TYPE_LABELS, PAIRS, PAIR_TIMES } from '@/lib/constants'
  import { cn, normalizeText } from '@/lib/utils'
  import {
    buildColumnSections,
    buildColumnSlots,
    columnGroupsStore,
  } from '@/stores/columnGroups'
  import { applyColumnOrder, columnOrderStore } from '@/stores/columnOrder'
  import type { RoomCell, RoomOccupancyIndex, RoomSlotEntry } from '@/stores/scheduleStore'
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

  let { roomData, groupFilter, search, lessonTypes }: RoomsViewProps = $props()
  let tooltip = $state<{ x: number; y: number; entries: RoomSlotEntry[] } | null>(null)
  let tooltipKey = $state<string | null>(null)
  let draggedRoom = $state<string | null>(null)

  let normalizedSearch = $derived(normalizeText(search))
  let filteredRoomData = $derived(filterRoomData(roomData, groupFilter, normalizedSearch, lessonTypes))
  let orderedRooms = $derived(applyColumnOrder(filteredRoomData?.orderedRooms || [], $columnOrderStore.rooms))
  let categoryByRoom = $derived(filteredRoomData?.categoryByRoom || {})
  let roomGroups = $derived($columnGroupsStore.rooms)
  let columnSections = $derived(buildColumnSections(orderedRooms, roomGroups))
  let columnSlots = $derived(buildColumnSlots(columnSections))
  let occupancy = $derived(filteredRoomData?.occupancy || {})
  let tooltipEntriesByKey = $derived(buildTooltipEntriesByKey(columnSlots.flatMap((slot) => (slot.column ? [slot.column] : [])), occupancy))
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
    if (draggedRoom) {
      hideTooltip()
      return
    }
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

  function filterRoomData(
    source: RoomOccupancyIndex | null,
    activeGroup: string,
    query: string,
    types: LessonType[],
  ): RoomOccupancyIndex | null {
    if (!source) return null
    if (activeGroup === 'all' && !query && types.length === 0) return source

    const occupancy: RoomOccupancyIndex['occupancy'] = {}

    source.orderedRooms.forEach((room) => {
      DAYS.forEach((day) => {
        PAIRS.forEach((pair) => {
          const cell = source.occupancy[room]?.[day]?.[pair]
          if (!cell) return
          const entries = cell.entries.filter((entry) => entryMatches(entry, activeGroup, query, types))
          if (entries.length === 0) return
          if (!occupancy[room]) occupancy[room] = {}
          if (!occupancy[room][day]) occupancy[room][day] = {}
          occupancy[room][day][pair] = summarizeRoomEntries(entries)
        })
      })
    })

    return {
      orderedRooms: source.orderedRooms,
      categoryByRoom: source.categoryByRoom,
      categoryStart: source.categoryStart,
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

  function clearColumnDrag() {
    draggedRoom = null
  }

  function startColumnDrag(event: DragEvent, room: string) {
    hideTooltip()
    draggedRoom = room
    event.dataTransfer?.setData('text/plain', room)
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move'
      setColumnDragImage(event, room)
    }
  }

  function setColumnDragImage(event: DragEvent, label: string) {
    if (!event.dataTransfer) return
    const dragImage = document.createElement('div')
    dragImage.className = 'matrix-drag-image'
    dragImage.textContent = label
    document.body.appendChild(dragImage)
    event.dataTransfer.setDragImage(dragImage, 12, 12)
    requestAnimationFrame(() => dragImage.remove())
  }

  function allowColumnDrop(event: DragEvent, room?: string) {
    if (!draggedRoom || draggedRoom === room) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  }

  function groupToneClass(tone: number | undefined) {
    return tone === undefined ? null : `matrix-group-tone-${tone}`
  }

  function groupSlotClasses(slot: ReturnType<typeof buildColumnSlots>[number]) {
    return cn(
      groupToneClass(slot.tone),
      slot.groupId && 'matrix-user-group-member',
      slot.groupStart && 'matrix-group-start',
      slot.groupEnd && 'matrix-group-end',
    )
  }

  function dropColumn(event: DragEvent, room: string) {
    event.preventDefault()
    const source = draggedRoom || event.dataTransfer?.getData('text/plain')
    if (source && source !== room) {
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
      const side = event.clientX < rect.left + rect.width / 2 ? 'before' : 'after'
      columnOrderStore.move('rooms', orderedRooms, source, room, side)
      const targetSlot = columnSlots.find((slot) => slot.column === room)
      if (targetSlot?.groupId) columnGroupsStore.assignItem('rooms', targetSlot.groupId, source)
      else columnGroupsStore.unassignItem('rooms', source)
    }
    clearColumnDrag()
  }

  function dropRoomOnGroup(groupId: string) {
    if (!draggedRoom) return
    const group = roomGroups.find((item) => item.id === groupId)
    const target = group?.items.filter((item) => item !== draggedRoom && orderedRooms.includes(item)).at(-1)
    columnGroupsStore.assignItem('rooms', groupId, draggedRoom)
    if (target) columnOrderStore.move('rooms', orderedRooms, draggedRoom, target, 'after')
    else columnOrderStore.moveToEnd('rooms', orderedRooms, draggedRoom)
    clearColumnDrag()
  }

  function addRoomGroup() {
    const name = prompt('Название группы кабинетов', `Группа ${roomGroups.length + 1}`)
    if (name === null) return
    columnGroupsStore.addGroup('rooms', name)
  }
</script>

{#if orderedRooms.length === 0}
  <Card contentClass="py-12 text-center">
    <div class="text-sm font-semibold">Кабинеты не найдены</div>
    <div class="mt-1 text-sm text-muted-foreground">Проверьте фильтры по группе, типу занятия или поиску.</div>
  </Card>
{:else}
  <div class="rooms-page">
    <div class="matrix-groups-toolbar">
      <Button variant="secondary" class="h-8 px-2.5 text-xs" onclick={addRoomGroup} title="Создать группу кабинетов">
        <Plus class="h-3.5 w-3.5" />
        Группа
      </Button>
    </div>

    <div class="room-matrix-wrap">
      <table class="room-matrix" onpointerover={handleTableHover} onmouseleave={hideTooltip}>
        <colgroup>
          <col style="width: 2rem" />
          <col style="width: 2rem" />
          {#each columnSlots as slot (slot.id)}
            <col />
          {/each}
        </colgroup>
        <thead>
          <tr class="matrix-group-row">
            <th class="th-day matrix-group-corner" colspan="2">Группы</th>
            {#each columnSections as section (section.id)}
              {#if section.type === 'group'}
                <th
                  class={cn(
                    'matrix-group-head',
                    groupToneClass(section.tone),
                    section.columns.length === 0 && 'matrix-group-head-empty',
                  )}
                  colspan={Math.max(section.columns.length, 1)}
                  ondragover={(event) => allowColumnDrop(event)}
                  ondrop={(event) => {
                    event.preventDefault()
                    if (section.groupId) dropRoomOnGroup(section.groupId)
                  }}
                  title={draggedRoom ? `Перетащить «${draggedRoom}» в ${section.name}` : section.name}
                >
                  <span class="matrix-group-head-name">{section.name}</span>
                  <button
                    class="matrix-group-head-delete"
                    type="button"
                    onclick={() => section.groupId && columnGroupsStore.removeGroup('rooms', section.groupId)}
                    title="Удалить группу"
                    aria-label={`Удалить ${section.name}`}
                  >
                    <Trash2 class="h-3.5 w-3.5" />
                  </button>
                </th>
              {:else}
                <th class="matrix-group-ungrouped" title="Без группы"></th>
              {/if}
            {/each}
          </tr>
          <tr class="matrix-column-row">
            <th class="th-day" title="День">Дн</th>
            <th class="th-pair" title="Пара">№</th>
            {#each columnSlots as slot (slot.id)}
              {#if slot.type === 'group-empty'}
                <th
                  class={cn('matrix-empty-group-slot', groupSlotClasses(slot))}
                  role="columnheader"
                  title="Перетащите кабинет в группу"
                  ondragover={(event) => allowColumnDrop(event)}
                  ondrop={(event) => {
                    event.preventDefault()
                    if (slot.groupId) dropRoomOnGroup(slot.groupId)
                  }}
                >
                  Перетащите
                </th>
              {:else if slot.column}
              {@const room = slot.column}
              {@const category = categoryByRoom[room]}
              <th
                class={cn(
                  'th-room matrix-draggable-header',
                  `th-cat-${category}`,
                  `cat-bg-${category}`,
                  groupSlotClasses(slot),
                  draggedRoom === room && 'matrix-col-dragging',
                )}
                title={room}
                draggable="true"
                aria-grabbed={draggedRoom === room}
                ondragstart={(event) => startColumnDrag(event, room)}
                ondragover={(event) => allowColumnDrop(event, room)}
                ondrop={(event) => dropColumn(event, room)}
                ondragend={clearColumnDrag}
              >
                {room}
              </th>
              {/if}
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
                {#each columnSlots as slot (slot.id)}
                  {#if slot.type === 'group-empty'}
                    <td
                      class={cn('slot-cell matrix-empty-group-body', groupSlotClasses(slot))}
                      role="gridcell"
                      ondragover={(event) => allowColumnDrop(event)}
                      ondrop={(event) => {
                        event.preventDefault()
                        if (slot.groupId) dropRoomOnGroup(slot.groupId)
                      }}
                    ></td>
                  {:else if slot.column}
                  {@const room = slot.column}
                  {@const cell = occupancy[room]?.[day]?.[pair]}
                  {@const category = categoryByRoom[room]}
                  {#if !cell}
                    <td class={cn('slot-cell slot-free', `cat-bg-${category}`, groupSlotClasses(slot))}></td>
                  {:else}
                    {@const typeClass = cell.allCancelled
                      ? 'slot-cancelled'
                      : cell.types.length > 1
                        ? 'slot-type-multi'
                        : `slot-type-${cell.types[0] || 'unknown'}`}
                    <td
                      class={cn('slot-cell slot-busy', typeClass, groupSlotClasses(slot))}
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
