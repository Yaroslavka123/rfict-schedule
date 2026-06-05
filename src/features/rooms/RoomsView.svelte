<script lang="ts">
  import { Plus, Trash2 } from '@lucide/svelte'

  import Card from '@/components/ui/Card.svelte'
  import Button from '@/components/ui/Button.svelte'
  import { LESSON_TYPE_LABELS, PAIRS, PAIR_TIMES } from '@/lib/constants'
  import { cn, normalizeSearchQuery } from '@/lib/utils'
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
  let dragOverRoom = $state<string | null>(null)
  let dragOverSide = $state<'before' | 'after' | null>(null)
  let dragOverGroupId = $state<string | null>(null)
  let recentlyDropped = $state<string | null>(null)
  let pendingTooltip = $state<{ x: number; y: number; key: string; entries: RoomSlotEntry[] } | null>(null)
  let tooltipFrame: number | null = null
  let dropFlashTimer: ReturnType<typeof setTimeout> | null = null

  let normalizedSearch = $derived(normalizeSearchQuery(search))
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

  function computeTooltipPos(clientX: number, clientY: number): { x: number; y: number } {
    const TIP_W = 320
    const TIP_H = 180
    const PAD = 10
    const OFFSET = 12
    const maxX = Math.max(PAD, window.innerWidth - TIP_W - PAD)
    const maxY = Math.max(PAD, window.innerHeight - TIP_H - PAD)
    return {
      x: Math.max(PAD, Math.min(clientX + OFFSET, maxX)),
      y: Math.max(PAD, Math.min(clientY + OFFSET, maxY)),
    }
  }

  function flushTooltip() {
    tooltipFrame = null
    if (!pendingTooltip) return
    const { x, y } = computeTooltipPos(pendingTooltip.x, pendingTooltip.y)
    tooltipKey = pendingTooltip.key
    tooltip = { x, y, entries: pendingTooltip.entries }
    pendingTooltip = null
  }

  function queueTooltip(event: MouseEvent, entries: RoomSlotEntry[], key: string) {
    pendingTooltip = { x: event.clientX, y: event.clientY, key, entries }
    if (tooltipFrame !== null) return
    tooltipFrame = requestAnimationFrame(flushTooltip)
  }

  function hideTooltip() {
    if (tooltipFrame !== null) cancelAnimationFrame(tooltipFrame)
    tooltipFrame = null
    pendingTooltip = null
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
    if (!key) {
      hideTooltip()
      return
    }
    if (key === tooltipKey && tooltip) {
      queueTooltip(event, tooltip.entries, key)
      return
    }
    const entries = tooltipEntriesByKey.get(key)
    if (entries?.length) queueTooltip(event, entries, key)
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
    dragOverRoom = null
    dragOverSide = null
    dragOverGroupId = null
  }

  function flashDropped(room: string) {
    recentlyDropped = room
    if (dropFlashTimer) clearTimeout(dropFlashTimer)
    dropFlashTimer = setTimeout(() => {
      recentlyDropped = null
      dropFlashTimer = null
    }, 220)
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
    if (!draggedRoom) return
    if (room && draggedRoom === room) {
      dragOverRoom = null
      dragOverSide = null
      dragOverGroupId = null
      return
    }
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    if (room) {
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
      const side = event.clientX < rect.left + rect.width / 2 ? 'before' : 'after'
      if (dragOverRoom !== room) dragOverRoom = room
      if (dragOverSide !== side) dragOverSide = side
      if (dragOverGroupId !== null) dragOverGroupId = null
    } else {
      if (dragOverRoom !== null) dragOverRoom = null
      if (dragOverSide !== null) dragOverSide = null
    }
  }

  function clearColumnHover(room: string) {
    if (dragOverRoom === room) {
      dragOverRoom = null
      dragOverSide = null
    }
  }

  function allowGroupDrop(event: DragEvent, groupId: string | undefined) {
    if (!draggedRoom || !groupId) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    if (dragOverGroupId !== groupId) dragOverGroupId = groupId
    if (dragOverRoom !== null) dragOverRoom = null
    if (dragOverSide !== null) dragOverSide = null
  }

  function clearGroupHover(groupId: string | undefined) {
    if (groupId && dragOverGroupId === groupId) dragOverGroupId = null
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
      flashDropped(source)
    }
    clearColumnDrag()
  }

  function dropRoomOnGroup(groupId: string) {
    if (!draggedRoom) return
    const source = draggedRoom
    const group = roomGroups.find((item) => item.id === groupId)
    const target = group?.items.filter((item) => item !== source && orderedRooms.includes(item)).at(-1)
    columnGroupsStore.assignItem('rooms', groupId, source)
    if (target) columnOrderStore.move('rooms', orderedRooms, source, target, 'after')
    else columnOrderStore.moveToEnd('rooms', orderedRooms, source)
    flashDropped(source)
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
      <Button variant="secondary" class="matrix-add-group-button" onclick={addRoomGroup} title="Создать группу кабинетов" aria-label="Создать группу кабинетов">
        <Plus class="h-3.5 w-3.5" />
      </Button>
    </div>

    <div class="room-matrix-wrap">
      <table class="room-matrix" onpointermove={handleTableHover} onmouseleave={hideTooltip}>
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
                  data-drag-over={dragOverGroupId === section.groupId ? 'true' : null}
                  ondragover={(event) => allowGroupDrop(event, section.groupId)}
                  ondragleave={() => clearGroupHover(section.groupId)}
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
              {@const room = slot.column || ''}
              {@const category = room ? categoryByRoom[room] : undefined}
              <th
                class={cn(
                  slot.type === 'group-empty' ? 'matrix-empty-group-slot' : 'th-room matrix-draggable-header',
                  category && `th-cat-${category}`,
                  category && `cat-bg-${category}`,
                  groupSlotClasses(slot),
                  draggedRoom === room && 'matrix-col-dragging',
                  dragOverRoom === room && 'matrix-drag-over-col',
                  dragOverRoom === room && dragOverSide === 'before' && 'matrix-drag-over-before',
                  dragOverRoom === room && dragOverSide === 'after' && 'matrix-drag-over-after',
                  recentlyDropped === room && 'matrix-just-dropped',
                )}
                role={slot.type === 'group-empty' ? 'columnheader' : undefined}
                title={slot.type === 'group-empty' ? 'Перетащите кабинет в группу' : room}
                data-drag-over={slot.type === 'group-empty' && dragOverGroupId === slot.groupId ? 'true' : null}
                draggable={Boolean(room)}
                aria-grabbed={room ? draggedRoom === room : undefined}
                ondragstart={(event) => {
                  if (room) startColumnDrag(event, room)
                }}
                ondragover={(event) => {
                  if (room) allowColumnDrop(event, room)
                  else allowGroupDrop(event, slot.groupId)
                }}
                ondragleave={() => {
                  if (room) clearColumnHover(room)
                  else clearGroupHover(slot.groupId)
                }}
                ondrop={(event) => {
                  if (room) {
                    dropColumn(event, room)
                    return
                  }
                  event.preventDefault()
                  if (slot.groupId) dropRoomOnGroup(slot.groupId)
                }}
                ondragend={clearColumnDrag}
              >
                {#if room}
                  {room}
                {:else}
                  Перетащите
                {/if}
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
        style={`left: 0; top: 0; transform: translate3d(${tooltip.x}px, ${tooltip.y}px, 0)`}
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
