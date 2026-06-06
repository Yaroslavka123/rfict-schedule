<script lang="ts">
  import { Plus, Trash2 } from '@lucide/svelte'
  import { flip } from 'svelte/animate'
  import { onDestroy } from 'svelte'

  import Card from '@/components/ui/Card.svelte'
  import Button from '@/components/ui/Button.svelte'
  import {
    buildColumnSections,
    buildColumnSlots,
    groupSlotClasses,
    groupToneClass,
    matchedColumnTokens,
    matrixColumnClass,
  } from '@/features/matrix/matrixColumns'
  import { LESSON_TYPE_LABELS, PAIRS, PAIR_TIMES } from '@/lib/constants'
  import {
    autoScrollMatrixWrap,
    createMatrixHitTestCache,
    resolveMatrixDropTarget,
    type MatrixHitTestCache,
    type MatrixDropSide,
    type MatrixDropTarget,
  } from '@/features/matrix/matrixDnd'
  import { filterTeacherMatrix, teacherSlotKey, type TeacherMatrixFilterResult } from '@/features/matrix/matrixFilter'
  import { openGoogleSheet } from '@/lib/googleSheets'
  import { cn, normalizeSearchQuery } from '@/lib/utils'
  import { columnGroupsStore } from '@/stores/columnGroups'
  import { applyColumnOrder, columnOrderStore } from '@/stores/columnOrder'
  import type { TeacherCell, TeacherOccupancyIndex, TeacherSlotEntry } from '@/stores/scheduleStore'
  import type { LessonType } from '@/types/schedule'

  interface TeachersViewProps {
    active: boolean
    teacherData: TeacherOccupancyIndex | null
    groupFilter: string
    search: string
    lessonTypes: LessonType[]
  }

  type TeacherSearchWorkerMessage = {
    type: 'teachers-result'
    id: number
  } & TeacherMatrixFilterResult

  interface TeacherTooltipBlock {
    subject: string
    room: string
    type: LessonType
    time: string
    cancelled: boolean
    groups: { name: string; subgroup: string | null; course?: number }[]
  }

  type IdleWindow = Window & {
    requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number
    cancelIdleCallback?: (id: number) => void
  }

  const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']

  let { active, teacherData, groupFilter, search, lessonTypes }: TeachersViewProps = $props()
  let tooltip = $state<{ x: number; y: number; entries: TeacherSlotEntry[]; teacher: string } | null>(null)
  let tooltipKey = $state<string | null>(null)
  let draggedTeacher = $state<string | null>(null)
  let dragOverTeacher = $state<string | null>(null)
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
  let pendingTooltip = $state<{ x: number; y: number; key: string; entries: TeacherSlotEntry[]; teacher: string } | null>(null)
  let pendingDragPoint: { x: number; y: number } | null = null
  let dragHitCache: MatrixHitTestCache | null = null
  let tooltipFrame: number | null = null
  let dragFrame: number | null = null
  let dropFlashTimer: ReturnType<typeof setTimeout> | null = null
  let matrixWrap: HTMLDivElement | null = $state(null)
  let lessonPress: { x: number; y: number; key: string } | null = null
  let searchWorker: Worker | null = null
  let searchWorkerSource: TeacherOccupancyIndex | null | undefined
  let fallbackSearchCancel: (() => void) | null = null
  let searchRequestId = 0

  let teacherCellByKey = $state<Map<string, TeacherCell> | null>(null)
  let teacherMatch = $state<ReadonlySet<string> | null>(null)
  let orderedTeachers = $derived(applyColumnOrder(teacherData?.orderedTeachers || [], $columnOrderStore.teachers))
  let teacherGroups = $derived($columnGroupsStore.teachers)
  let columnSections = $derived(buildColumnSections(orderedTeachers, teacherGroups))
  let columnSlots = $derived(buildColumnSlots(columnSections))
  let teacherHighlightColumns = $derived(matchedColumnTokens(columnSlots, teacherMatch))
  let teacherHasDimmedColumns = $derived(Boolean(teacherMatch))
  let occupancy = $derived(teacherData?.occupancy || {})
  let normalizedSearch = $derived(normalizeSearchQuery(search.trim()))
  let tooltipMerged = $derived(tooltip ? mergeTooltipEntries(tooltip.entries) : [])

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

    const source = teacherData
    const activeGroup = groupFilter
    const query = normalizedSearch
    const types = lessonTypes
    const requestId = ++searchRequestId
    cancelFallbackSearch()

    if (!source) {
      teacherCellByKey = null
      teacherMatch = null
      return
    }

    if (activeGroup === 'all' && !query && types.length === 0) {
      teacherCellByKey = null
      teacherMatch = null
      return
    }

    if (typeof Worker !== 'undefined') {
      try {
        const worker = getSearchWorker()
        if (searchWorkerSource !== source) {
          searchWorkerSource = source
          worker.postMessage({ type: 'set-teachers-source', source })
        }
        worker.postMessage({ type: 'run-teachers', id: requestId, activeGroup, query, types })
        scheduleFallbackSearch(() => {
          applyFallbackTeacherSearch(requestId, source, activeGroup, query, types)
        }, 240)
        return
      } catch {
        searchWorker?.terminate()
        searchWorker = null
        searchWorkerSource = undefined
      }
    }

    scheduleFallbackSearch(() => {
      applyFallbackTeacherSearch(requestId, source, activeGroup, query, types)
    })
  })

  function getSearchWorker() {
    if (searchWorker) return searchWorker
    const worker = new Worker(new URL('../matrix/matrixWorkerClient.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<TeacherSearchWorkerMessage>) => {
      const message = event.data
      if (message.type !== 'teachers-result' || message.id !== searchRequestId) return
      cancelFallbackSearch()
      applyTeacherFilterResult(teacherData, message)
    }
    searchWorker = worker
    return worker
  }

  function applyFallbackTeacherSearch(
    requestId: number,
    source: TeacherOccupancyIndex,
    activeGroup: string,
    query: string,
    types: LessonType[],
  ) {
    if (requestId !== searchRequestId) return
    applyTeacherFilterResult(source, filterTeacherMatrix(source, activeGroup, query, types))
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

  function slotKey(teacher: string, day: string, pair: number) {
    return teacherSlotKey(teacher, day, pair)
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
    tooltip = { x, y, entries: pendingTooltip.entries, teacher: pendingTooltip.teacher }
    pendingTooltip = null
  }

  function queueTooltip(event: MouseEvent, entries: TeacherSlotEntry[], teacher: string, key: string) {
    pendingTooltip = { x: event.clientX, y: event.clientY, entries, teacher, key }
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
    if (draggedTeacher) {
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
      queueTooltip(event, tooltip.entries, tooltip.teacher, key)
      return
    }
    const teacher = cell.dataset.matrixColumn
    const day = cell.dataset.slotDay
    const pair = Number(cell.dataset.slotPair)
    const entries = teacher && day && Number.isFinite(pair) ? getVisibleTeacherCell(teacher, day, pair)?.entries : null
    if (entries?.length && teacher) queueTooltip(event, entries, teacher, key)
    else hideTooltip()
  }

  function summarizeTeacherEntries(entries: TeacherSlotEntry[]): TeacherCell {
    return {
      entries,
      allCancelled: entries.every((entry) => entry.cancelled),
      types: Array.from(new Set(entries.map((entry) => entry.type))),
      rooms: Array.from(new Set(entries.map((entry) => entry.room).filter(Boolean))),
    }
  }

  function buildTeacherCellMap(source: TeacherOccupancyIndex, cells: TeacherMatrixFilterResult['cells']) {
    if (cells === null) return null
    const map = new Map<string, TeacherCell>()
    cells.forEach(([key, entryIndexes]) => {
      const [encodedTeacher, day, pairValue] = key.split('|')
      const teacher = decodeURIComponent(encodedTeacher || '')
      const cell = source.occupancy[teacher]?.[day]?.[Number(pairValue)]
      if (!cell) return
      const entries = entryIndexes
        .map((index) => cell.entries[index])
        .filter((entry): entry is TeacherSlotEntry => Boolean(entry))
      if (entries.length === 0) return
      map.set(key, entries.length === cell.entries.length ? cell : summarizeTeacherEntries(entries))
    })
    return map
  }

  function applyTeacherFilterResult(source: TeacherOccupancyIndex | null, result: TeacherMatrixFilterResult) {
    teacherCellByKey = source ? buildTeacherCellMap(source, result.cells) : null
    teacherMatch = result.matches
  }

  function getVisibleTeacherCell(teacher: string, day: string, pair: number): TeacherCell | null {
    if (!teacherCellByKey) return occupancy[teacher]?.[day]?.[pair] || null
    return teacherCellByKey.get(slotKey(teacher, day, pair)) || null
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

  function mergeTooltipEntries(entries: TeacherSlotEntry[]): TeacherTooltipBlock[] {
    const map = new Map<string, TeacherTooltipBlock>()
    entries.forEach((entry) => {
      const key = [entry.subject, entry.room, entry.type, entry.time, entry.cancelled].join('|')
      const current = map.get(key)
      if (current) {
        if (entry.group && !current.groups.some((group) => group.name === entry.group && group.subgroup === entry.subgroup)) {
          current.groups.push({ name: entry.group, subgroup: entry.subgroup || null, course: entry.course })
        }
        return
      }
      map.set(key, {
        subject: entry.subject,
        room: entry.room,
        type: entry.type,
        time: entry.time,
        cancelled: entry.cancelled,
        groups: entry.group ? [{ name: entry.group, subgroup: entry.subgroup || null, course: entry.course }] : [],
      })
    })
    return Array.from(map.values())
  }

  function formatTooltipGroup(group: TeacherTooltipBlock['groups'][number]) {
    return `${group.name}${group.subgroup ? ` (${formatSubgroup(group.subgroup)})` : ''}`
  }

  function formatTooltipGroups(groups: TeacherTooltipBlock['groups']) {
    const byCourse = new Map<string, string[]>()
    groups.forEach((group) => {
      const key = group.course ? String(group.course) : ''
      if (!byCourse.has(key)) byCourse.set(key, [])
      byCourse.get(key)!.push(formatTooltipGroup(group))
    })
    return Array.from(byCourse.entries())
      .map(([course, values]) => course ? `${course} курс: ${values.join(', ')}` : values.join(', '))
      .join('; ')
  }

  function shortTeacherName(full: string): string {
    const trimmed = full.trim()
    if (trimmed.length <= 22) return trimmed
    return `${trimmed.slice(0, 21)}...`
  }

  function sheetIdForEntries(entries: TeacherSlotEntry[]) {
    return entries.find((entry) => entry.googleSheetId)?.googleSheetId || null
  }

  function startLessonPress(event: PointerEvent, key: string) {
    if (event.button !== 0) return
    lessonPress = { x: event.clientX, y: event.clientY, key }
  }

  function finishLessonPress(event: PointerEvent, key: string, entries: TeacherSlotEntry[]) {
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
    draggedTeacher = null
    dragOverTeacher = null
    dragOverSide = null
    dragOverGroupId = null
  }

  function flashDropped(teacher: string) {
    recentlyDropped = teacher
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
      dragOverTeacher = null
      dragOverSide = null
      dragOverGroupId = null
      return
    }
    if (target.type === 'column') {
      dragOverTeacher = target.column
      dragOverSide = target.side
      dragOverGroupId = null
      return
    }
    dragOverTeacher = null
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

  function startColumnPointer(event: PointerEvent, teacher: string) {
    if (event.button !== 0) return
    hideTooltip()
    pointerDrag = {
      pointerId: event.pointerId,
      source: teacher,
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
      draggedTeacher = pointerDrag.source
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

  function commitColumnDrop(source: string, teacher: string, side: MatrixDropSide) {
    if (source === teacher) return
    runMatrixTransition(() => {
      columnOrderStore.move('teachers', orderedTeachers, source, teacher, side)
      const targetSlot = columnSlots.find((slot) => slot.column === teacher)
      if (targetSlot?.groupId) columnGroupsStore.assignItem('teachers', targetSlot.groupId, source)
      else columnGroupsStore.unassignItem('teachers', source)
    })
    flashDropped(source)
  }

  function commitGroupDrop(source: string, groupId: string) {
    const group = teacherGroups.find((item) => item.id === groupId)
    const target = group?.items.filter((item) => item !== source && orderedTeachers.includes(item)).at(-1)
    runMatrixTransition(() => {
      columnGroupsStore.assignItem('teachers', groupId, source)
      if (target) columnOrderStore.move('teachers', orderedTeachers, source, target, 'after')
      else columnOrderStore.moveToEnd('teachers', orderedTeachers, source)
    })
    flashDropped(source)
  }

  function addTeacherGroup() {
    const name = prompt('Название группы преподавателей', `Группа ${teacherGroups.length + 1}`)
    if (name === null) return
    columnGroupsStore.addGroup('teachers', name)
  }
</script>

{#if orderedTeachers.length === 0}
  <Card contentClass="py-12 text-center">
    <div class="text-sm font-semibold">Преподаватели не найдены</div>
    <div class="mt-1 text-sm text-muted-foreground">Измените тип занятия или поисковый запрос.</div>
  </Card>
{:else}
  <div class="teachers-page">
    <div class="matrix-groups-toolbar">
      <Button variant="secondary" class="matrix-add-group-button" onclick={addTeacherGroup} title="Создать группу преподавателей" aria-label="Создать группу преподавателей">
        <Plus class="h-3.5 w-3.5" />
      </Button>
    </div>

    <div class="teachers-matrix-wrap" bind:this={matrixWrap}>
      <table
        class="teachers-matrix"
        data-highlight={teacherHighlightColumns || null}
        data-dim={teacherHasDimmedColumns ? 'true' : null}
        onpointermove={handleTableHover}
        onmouseleave={hideTooltip}
      >
        <colgroup>
          <col style="width: 2rem" />
          <col style="width: 2rem" />
          {#each columnSlots as slot, slotIndex (slot.id)}
            <col
              class={cn(
                matrixColumnClass(slotIndex),
                slot.column && teacherMatch?.has(slot.column) && 'matrix-col-match',
                slot.column && teacherMatch && !teacherMatch.has(slot.column) && 'matrix-col-dim',
              )}
            />
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
                  title={draggedTeacher ? `Перетащить «${draggedTeacher}» в ${section.name}` : section.name}
                >
                  <span class="matrix-group-head-name">{section.name}</span>
                  <button
                    class="matrix-group-head-delete"
                    type="button"
                    onclick={() => section.groupId && columnGroupsStore.removeGroup('teachers', section.groupId)}
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
            {#each columnSlots as slot, slotIndex (slot.id)}
              {@const teacher = slot.column || ''}
              {@const isMatch = teacher ? teacherMatch?.has(teacher) : false}
              {@const isDim = Boolean(teacher && teacherMatch && !isMatch)}
              <th
                animate:flip={{ duration: 170 }}
                class={cn(
                  slot.type === 'group-empty' ? 'matrix-empty-group-slot' : 'th-teacher matrix-draggable-header',
                  matrixColumnClass(slotIndex),
                  isMatch && 'th-teacher-match',
                  isDim && 'th-teacher-dim',
                  groupSlotClasses(slot),
                  draggedTeacher === teacher && 'matrix-col-dragging',
                  dragOverTeacher === teacher && 'matrix-drag-over-col',
                  dragOverTeacher === teacher && dragOverSide === 'before' && 'matrix-drag-over-before',
                  dragOverTeacher === teacher && dragOverSide === 'after' && 'matrix-drag-over-after',
                  recentlyDropped === teacher && 'matrix-just-dropped',
                )}
                role={slot.type === 'group-empty' ? 'columnheader' : undefined}
                title={slot.type === 'group-empty' ? 'Перетащите преподавателя в группу' : teacher}
                data-matrix-column={teacher || null}
                data-matrix-group-id={slot.type === 'group-empty' ? slot.groupId : null}
                data-drag-over={slot.type === 'group-empty' && dragOverGroupId === slot.groupId ? 'true' : null}
                aria-grabbed={teacher ? draggedTeacher === teacher : undefined}
                onpointerdown={(event) => {
                  if (teacher) startColumnPointer(event, teacher)
                }}
                onpointermove={moveColumnPointer}
                onpointerup={finishColumnPointer}
                onpointercancel={cancelColumnPointer}
              >
                {#if teacher}
                  <div class="th-teacher-label">{shortTeacherName(teacher)}</div>
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
                {#each columnSlots as slot, slotIndex (slot.id)}
                  {#if slot.type === 'group-empty'}
                    <td
                      class={cn('slot-cell matrix-empty-group-body', matrixColumnClass(slotIndex), groupSlotClasses(slot))}
                      role="gridcell"
                      data-matrix-group-id={slot.groupId}
                    ></td>
                  {:else if slot.column}
                  {@const teacher = slot.column}
                  {@const cell = getVisibleTeacherCell(teacher, day, pair)}
                  {#if !cell}
                    <td
                      class={cn('slot-cell slot-free', matrixColumnClass(slotIndex), groupSlotClasses(slot))}
                      data-matrix-column={teacher}
                    ></td>
                  {:else}
                    {@const cellKey = slotKey(teacher, day, pair)}
                    {@const hasSheet = Boolean(sheetIdForEntries(cell.entries))}
                    {@const typeClass = cell.allCancelled
                      ? 'slot-cancelled'
                      : cell.types.length > 1
                        ? 'slot-type-multi'
                        : `slot-type-${cell.types[0] || 'unknown'}`}
                    <td
                      class={cn('slot-cell slot-busy', matrixColumnClass(slotIndex), typeClass, hasSheet && 'slot-clickable', groupSlotClasses(slot))}
                      data-slot-key={cellKey}
                      data-slot-day={day}
                      data-slot-pair={pair}
                      data-matrix-column={teacher}
                      title={hasSheet ? 'Открыть Google Таблицу' : undefined}
                      onpointerdown={(event) => startLessonPress(event, cellKey)}
                      onpointerup={(event) => finishLessonPress(event, cellKey, cell.entries)}
                      onpointercancel={cancelLessonPress}
                    >
                      <div class={cn('slot-content', cell.allCancelled && 'line-through')}>
                        <div class="slot-main">{cell.rooms[0] || '—'}</div>
                        {#if cell.rooms.length > 1}
                          <span class="slot-badge slot-badge-group" title={`Кабинетов: ${cell.rooms.length}`}>
                            {cell.rooms.length}
                          </span>
                        {/if}
                      </div>
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
        <div class="mb-1 font-bold text-primary">{tooltip.teacher || '—'}</div>
        {#each tooltipMerged as entry, idx (`${entry.subject}-${entry.room}-${idx}`)}
          <div>
            {#if idx > 0}
              <hr class="my-1.5 border-border" />
            {/if}
            <div class={cn('font-semibold', entry.cancelled ? 'text-red-500 line-through' : 'text-amber-400')}>
              {entry.subject || '—'}
            </div>
            <div class="text-emerald-400">Кабинет: {entry.room || '—'}</div>
            <div class="text-emerald-400">
              {#if entry.groups.length > 0}
                {formatTooltipGroups(entry.groups)}
              {:else}
                —
              {/if}
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
