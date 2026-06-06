<script lang="ts">
  import { Plus, Trash2 } from '@lucide/svelte'
  import { flip } from 'svelte/animate'
  import { onDestroy } from 'svelte'

  import Card from '@/components/ui/Card.svelte'
  import Button from '@/components/ui/Button.svelte'
  import { LESSON_TYPE_LABELS, PAIRS, PAIR_TIMES } from '@/lib/constants'
  import {
    autoScrollMatrixWrap,
    createMatrixHitTestCache,
    resolveMatrixDropTarget,
    type MatrixHitTestCache,
    type MatrixDropSide,
    type MatrixDropTarget,
  } from '@/lib/matrixDrag'
  import { filterRoomMatrix, roomSlotKey, type RoomMatrixFilterResult } from '@/lib/matrixFilter'
  import { openGoogleSheet } from '@/lib/googleSheets'
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
    active: boolean
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

  type RoomSearchWorkerMessage = {
    type: 'rooms-result'
    id: number
  } & RoomMatrixFilterResult

  type IdleWindow = Window & {
    requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number
    cancelIdleCallback?: (id: number) => void
  }

  const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']

  let { active, roomData, groupFilter, search, lessonTypes }: RoomsViewProps = $props()
  let tooltip = $state<{ x: number; y: number; entries: RoomSlotEntry[] } | null>(null)
  let tooltipKey = $state<string | null>(null)
  let draggedRoom = $state<string | null>(null)
  let dragOverRoom = $state<string | null>(null)
  let dragOverSide = $state<'before' | 'after' | null>(null)
  let dragOverGroupId = $state<string | null>(null)
  let recentlyDropped = $state<string | null>(null)
  let dragPreview = $state<{ x: number; y: number; label: string } | null>(null)
  let pointerDrag = $state<{
    pointerId: number
    source: string
    startX: number
    startY: number
    active: boolean
  } | null>(null)
  let pendingTooltip = $state<{ x: number; y: number; key: string; entries: RoomSlotEntry[] } | null>(null)
  let pendingDragPoint: { x: number; y: number } | null = null
  let dragHitCache: MatrixHitTestCache | null = null
  let tooltipFrame: number | null = null
  let dragFrame: number | null = null
  let dropFlashTimer: ReturnType<typeof setTimeout> | null = null
  let matrixWrap: HTMLDivElement | null = $state(null)
  let lessonPress: { x: number; y: number; key: string } | null = null
  let searchWorker: Worker | null = null
  let searchWorkerSource: RoomOccupancyIndex | null | undefined
  let fallbackSearchCancel: (() => void) | null = null
  let searchRequestId = 0

  let normalizedSearch = $derived(normalizeSearchQuery(search))
  let roomCellByKey = $state<Map<string, RoomCell> | null>(null)
  let roomMatch = $state<ReadonlySet<string> | null>(null)
  let orderedRooms = $derived(applyColumnOrder(roomData?.orderedRooms || [], $columnOrderStore.rooms))
  let categoryByRoom = $derived(roomData?.categoryByRoom || {})
  let roomGroups = $derived($columnGroupsStore.rooms)
  let columnSections = $derived(buildColumnSections(orderedRooms, roomGroups))
  let columnSlots = $derived(buildColumnSlots(columnSections))
  let occupancy = $derived(roomData?.occupancy || {})
  let tooltipMerged = $derived(tooltip ? mergeTooltipEntries(tooltip.entries) : [])
  let tooltipRoom = $derived(tooltip?.entries[0]?.room || '')

  onDestroy(() => {
    cancelFallbackSearch()
    searchWorker?.terminate()
    searchWorker = null
  })

  $effect(() => {
    const isActive = active
    if (!isActive) {
      cancelFallbackSearch()
      return
    }

    const source = roomData
    const activeGroup = groupFilter
    const query = normalizedSearch
    const types = lessonTypes
    const requestId = ++searchRequestId
    cancelFallbackSearch()

    if (!source) {
      roomCellByKey = null
      roomMatch = null
      return
    }

    if (activeGroup === 'all' && !query && types.length === 0) {
      roomCellByKey = null
      roomMatch = null
      return
    }

    if (typeof Worker !== 'undefined') {
      try {
        const worker = getSearchWorker()
        if (searchWorkerSource !== source) {
          searchWorkerSource = source
          worker.postMessage({ type: 'set-rooms-source', source })
        }
        worker.postMessage({ type: 'run-rooms', id: requestId, activeGroup, query, types })
        scheduleFallbackSearch(() => {
          applyFallbackRoomSearch(requestId, source, activeGroup, query, types)
        }, 240)
        return
      } catch {
        searchWorker?.terminate()
        searchWorker = null
        searchWorkerSource = undefined
      }
    }

    scheduleFallbackSearch(() => {
      applyFallbackRoomSearch(requestId, source, activeGroup, query, types)
    })
  })

  function getSearchWorker() {
    if (searchWorker) return searchWorker
    const worker = new Worker(new URL('../../lib/matrixSearchWorker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<RoomSearchWorkerMessage>) => {
      const message = event.data
      if (message.type !== 'rooms-result' || message.id !== searchRequestId) return
      cancelFallbackSearch()
      applyRoomFilterResult(roomData, message)
    }
    searchWorker = worker
    return worker
  }

  function applyFallbackRoomSearch(
    requestId: number,
    source: RoomOccupancyIndex,
    activeGroup: string,
    query: string,
    types: LessonType[],
  ) {
    if (requestId !== searchRequestId) return
    applyRoomFilterResult(source, filterRoomMatrix(source, activeGroup, query, types))
  }

  function cancelFallbackSearch() {
    fallbackSearchCancel?.()
    fallbackSearchCancel = null
  }

  function scheduleFallbackSearch(callback: () => void, delay = 0) {
    let cancelled = false
    const win = window as IdleWindow
    let idleId: number | null = null

    const run = () => {
      if (cancelled) return
      if (typeof win.requestIdleCallback === 'function') {
        idleId = win.requestIdleCallback(() => {
          if (!cancelled) callback()
        }, { timeout: 180 })
        return
      }
      callback()
    }

    const id = window.setTimeout(run, delay)
    fallbackSearchCancel = () => {
      cancelled = true
      window.clearTimeout(id)
      if (idleId !== null) win.cancelIdleCallback?.(idleId)
    }
  }

  function slotKey(room: string, day: string, pair: number) {
    return roomSlotKey(room, day, pair)
  }

  function computeTooltipPos(clientX: number, clientY: number): { x: number; y: number } {
    const TIP_W = 320
    const TIP_H = 180
    const PAD = 10
    const OFFSET = 8
    const maxX = Math.max(PAD, window.innerWidth - TIP_W - PAD)
    const maxY = Math.max(PAD, window.innerHeight - TIP_H - PAD)
    const preferredX = Math.min(clientX + OFFSET, maxX)
    const preferredY = Math.min(clientY + OFFSET, maxY)
    return {
      x: Math.max(PAD, preferredX),
      y: Math.max(PAD, preferredY),
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
    const room = cell.dataset.matrixColumn
    const day = cell.dataset.slotDay
    const pair = Number(cell.dataset.slotPair)
    const entries = room && day && Number.isFinite(pair) ? getVisibleRoomCell(room, day, pair)?.entries : null
    if (entries?.length) queueTooltip(event, entries, key)
    else hideTooltip()
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

  function buildRoomCellMap(source: RoomOccupancyIndex, cells: RoomMatrixFilterResult['cells']) {
    if (cells === null) return null
    const map = new Map<string, RoomCell>()
    cells.forEach(([key, entryIndexes]) => {
      const [encodedRoom, day, pairValue] = key.split('|')
      const room = decodeURIComponent(encodedRoom || '')
      const cell = source.occupancy[room]?.[day]?.[Number(pairValue)]
      if (!cell) return
      const entries = entryIndexes
        .map((index) => cell.entries[index])
        .filter((entry): entry is RoomSlotEntry => Boolean(entry))
      if (entries.length === 0) return
      map.set(key, entries.length === cell.entries.length ? cell : summarizeRoomEntries(entries))
    })
    return map
  }

  function applyRoomFilterResult(source: RoomOccupancyIndex | null, result: RoomMatrixFilterResult) {
    roomCellByKey = source ? buildRoomCellMap(source, result.cells) : null
    roomMatch = result.matches
  }

  function getVisibleRoomCell(room: string, day: string, pair: number): RoomCell | null {
    if (!roomCellByKey) return occupancy[room]?.[day]?.[pair] || null
    return roomCellByKey.get(slotKey(room, day, pair)) || null
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

  function formatTooltipGroup(group: TooltipPerSubject['groups'][number]) {
    return `${group.name}${group.subgroup ? ` (${formatSubgroup(group.subgroup)})` : ''}`
  }

  function formatTooltipGroups(groups: TooltipPerSubject['groups']) {
    const byCourse = new Map<string, string[]>()
    groups.forEach((group) => {
      const key = group.course ? String(group.course) : ''
      if (!byCourse.has(key)) byCourse.set(key, [])
      byCourse.get(key)!.push(formatTooltipGroup(group))
    })
    const courseKeys = Array.from(byCourse.keys()).filter(Boolean)
    return Array.from(byCourse.entries())
      .map(([course, values]) => course && courseKeys.length > 1 ? `${course} курс: ${values.join(', ')}` : values.join(', '))
      .join('; ')
  }

  function shortenSubject(subject: string) {
    if (!subject) return 'Занято'
    return subject.length > 14 ? `${subject.slice(0, 13)}...` : subject
  }

  function sheetIdForEntries(entries: RoomSlotEntry[]) {
    return entries.find((entry) => entry.googleSheetId)?.googleSheetId || null
  }

  function startLessonPress(event: PointerEvent, key: string) {
    if (event.button !== 0) return
    lessonPress = { x: event.clientX, y: event.clientY, key }
  }

  function finishLessonPress(event: PointerEvent, key: string, entries: RoomSlotEntry[]) {
    if (!lessonPress || lessonPress.key !== key) return
    const distance = Math.hypot(event.clientX - lessonPress.x, event.clientY - lessonPress.y)
    lessonPress = null
    if (distance > 5) return
    const sheetId = sheetIdForEntries(entries)
    if (!sheetId) return
    event.preventDefault()
    event.stopPropagation()
    openGoogleSheet(sheetId)
  }

  function cancelLessonPress() {
    lessonPress = null
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
    }, 420)
  }

  type ViewTransitionDocument = Document & {
    startViewTransition?: (callback: () => void) => { finished: Promise<void> }
  }

  function runMatrixTransition(update: () => void) {
    const doc = document as ViewTransitionDocument
    if (!doc.startViewTransition) {
      update()
      return
    }
    document.documentElement.classList.add('matrix-reorder')
    const transition = doc.startViewTransition(update)
    void transition.finished.finally(() => {
      document.documentElement.classList.remove('matrix-reorder')
    })
  }

  function applyDropTarget(target: MatrixDropTarget) {
    if (!target) {
      dragOverRoom = null
      dragOverSide = null
      dragOverGroupId = null
      return
    }
    if (target.type === 'column') {
      dragOverRoom = target.column
      dragOverSide = target.side
      dragOverGroupId = null
      return
    }
    dragOverRoom = null
    dragOverSide = null
    dragOverGroupId = target.groupId
  }

  function flushPointerDrag() {
    dragFrame = null
    if (!pendingDragPoint || !pointerDrag?.active) return
    const point = pendingDragPoint
    pendingDragPoint = null
    dragPreview = { x: point.x, y: point.y, label: pointerDrag.source }
    autoScrollMatrixWrap(matrixWrap, point.x, point.y)
    applyDropTarget(resolveMatrixDropTarget(point.x, point.y, pointerDrag.source, dragHitCache))
  }

  function queuePointerDrag(clientX: number, clientY: number) {
    pendingDragPoint = { x: clientX, y: clientY }
    if (dragFrame !== null) return
    dragFrame = requestAnimationFrame(flushPointerDrag)
  }

  function startColumnPointer(event: PointerEvent, room: string) {
    if (event.button !== 0) return
    hideTooltip()
    pointerDrag = {
      pointerId: event.pointerId,
      source: room,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
    }
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  }

  function moveColumnPointer(event: PointerEvent) {
    if (!pointerDrag || event.pointerId !== pointerDrag.pointerId) return
    const distance = Math.hypot(event.clientX - pointerDrag.startX, event.clientY - pointerDrag.startY)
    if (!pointerDrag.active) {
      if (distance < 4) return
      pointerDrag = { ...pointerDrag, active: true }
      draggedRoom = pointerDrag.source
      dragHitCache = createMatrixHitTestCache(matrixWrap)
      document.documentElement.classList.add('matrix-dragging-page')
    }
    event.preventDefault()
    queuePointerDrag(event.clientX, event.clientY)
  }

  function cleanupPointerDrag(captureTarget?: HTMLElement, pointerId?: number) {
    if (dragFrame !== null) cancelAnimationFrame(dragFrame)
    dragFrame = null
    pendingDragPoint = null
    dragHitCache = null
    dragPreview = null
    pointerDrag = null
    document.documentElement.classList.remove('matrix-dragging-page')
    if (captureTarget && pointerId !== undefined && captureTarget.hasPointerCapture(pointerId)) {
      captureTarget.releasePointerCapture(pointerId)
    }
    clearColumnDrag()
  }

  function finishColumnPointer(event: PointerEvent) {
    if (!pointerDrag || event.pointerId !== pointerDrag.pointerId) return
    const target = pointerDrag.active
      ? resolveMatrixDropTarget(event.clientX, event.clientY, pointerDrag.source, dragHitCache)
      : null
    const source = pointerDrag.source
    cleanupPointerDrag(event.currentTarget as HTMLElement, event.pointerId)
    if (!target) return
    if (target.type === 'column') commitColumnDrop(source, target.column, target.side)
    else commitGroupDrop(source, target.groupId)
  }

  function cancelColumnPointer(event: PointerEvent) {
    if (!pointerDrag || event.pointerId !== pointerDrag.pointerId) return
    cleanupPointerDrag(event.currentTarget as HTMLElement, event.pointerId)
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

  function commitColumnDrop(source: string, room: string, side: MatrixDropSide) {
    if (source === room) return
    runMatrixTransition(() => {
      columnOrderStore.move('rooms', orderedRooms, source, room, side)
      const targetSlot = columnSlots.find((slot) => slot.column === room)
      if (targetSlot?.groupId) columnGroupsStore.assignItem('rooms', targetSlot.groupId, source)
      else columnGroupsStore.unassignItem('rooms', source)
    })
    flashDropped(source)
  }

  function commitGroupDrop(source: string, groupId: string) {
    const group = roomGroups.find((item) => item.id === groupId)
    const target = group?.items.filter((item) => item !== source && orderedRooms.includes(item)).at(-1)
    runMatrixTransition(() => {
      columnGroupsStore.assignItem('rooms', groupId, source)
      if (target) columnOrderStore.move('rooms', orderedRooms, source, target, 'after')
      else columnOrderStore.moveToEnd('rooms', orderedRooms, source)
    })
    flashDropped(source)
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

    <div class="room-matrix-wrap" bind:this={matrixWrap}>
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
                  data-matrix-group-id={section.groupId}
                  data-drag-over={dragOverGroupId === section.groupId ? 'true' : null}
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
              {@const isMatch = room ? roomMatch?.has(room) : false}
              {@const isDim = Boolean(room && roomMatch && !isMatch)}
              <th
                animate:flip={{ duration: 170 }}
                class={cn(
                  slot.type === 'group-empty' ? 'matrix-empty-group-slot' : 'th-room matrix-draggable-header',
                  category && `th-cat-${category}`,
                  category && `cat-bg-${category}`,
                  isMatch && 'th-room-match',
                  isDim && 'th-room-dim',
                  groupSlotClasses(slot),
                  draggedRoom === room && 'matrix-col-dragging',
                  dragOverRoom === room && 'matrix-drag-over-col',
                  dragOverRoom === room && dragOverSide === 'before' && 'matrix-drag-over-before',
                  dragOverRoom === room && dragOverSide === 'after' && 'matrix-drag-over-after',
                  recentlyDropped === room && 'matrix-just-dropped',
                )}
                role={slot.type === 'group-empty' ? 'columnheader' : undefined}
                title={slot.type === 'group-empty' ? 'Перетащите кабинет в группу' : room}
                data-matrix-column={room || null}
                data-matrix-group-id={slot.type === 'group-empty' ? slot.groupId : null}
                data-drag-over={slot.type === 'group-empty' && dragOverGroupId === slot.groupId ? 'true' : null}
                aria-grabbed={room ? draggedRoom === room : undefined}
                onpointerdown={(event) => {
                  if (room) startColumnPointer(event, room)
                }}
                onpointermove={moveColumnPointer}
                onpointerup={finishColumnPointer}
                onpointercancel={cancelColumnPointer}
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
                      data-matrix-group-id={slot.groupId}
                    ></td>
                  {:else if slot.column}
                  {@const room = slot.column}
                  {@const cell = getVisibleRoomCell(room, day, pair)}
                  {@const category = categoryByRoom[room]}
                  {@const isMatch = roomMatch?.has(room)}
                  {@const isDim = roomMatch && !isMatch}
                  {#if !cell}
                    <td
                      class={cn('slot-cell slot-free', `cat-bg-${category}`, isMatch && 'slot-column-match', isDim && 'slot-dim', groupSlotClasses(slot))}
                      data-matrix-column={room}
                    ></td>
                  {:else}
                    {@const cellKey = slotKey(room, day, pair)}
                    {@const hasSheet = Boolean(sheetIdForEntries(cell.entries))}
                    {@const typeClass = cell.allCancelled
                      ? 'slot-cancelled'
                      : cell.types.length > 1
                        ? 'slot-type-multi'
                        : `slot-type-${cell.types[0] || 'unknown'}`}
                    <td
                      class={cn('slot-cell slot-busy', typeClass, isMatch && 'slot-column-match', isDim && 'slot-dim', hasSheet && 'slot-clickable', groupSlotClasses(slot))}
                      data-slot-key={cellKey}
                      data-slot-day={day}
                      data-slot-pair={pair}
                      data-matrix-column={room}
                      title={hasSheet ? 'Открыть Google Таблицу' : undefined}
                      onpointerdown={(event) => startLessonPress(event, cellKey)}
                      onpointerup={(event) => finishLessonPress(event, cellKey, cell.entries)}
                      onpointercancel={cancelLessonPress}
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

    {#if dragPreview}
      <div
        class="matrix-drag-preview pointer-events-none fixed left-0 top-0 z-[160]"
        style={`transform: translate3d(${dragPreview.x + 12}px, ${dragPreview.y + 12}px, 0)`}
      >
        {dragPreview.label}
      </div>
    {/if}

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
                {formatTooltipGroups(entry.groups)}
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
