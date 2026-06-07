<script lang="ts">
  import { Plus, Trash2 } from '@lucide/svelte'
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
  import {
    autoScrollMatrixWrap,
    createMatrixHitTestCache,
    resolveMatrixDropTarget,
    type MatrixDropSide,
    type MatrixDropTarget,
    type MatrixHitTestCache,
  } from '@/features/matrix/matrixDnd'
  import type { MatrixAdapter, MatrixRenderCell } from '@/features/matrix/matrixTypes'
  import { PAIRS, PAIR_TIMES } from '@/lib/constants'
  import { openGoogleSheet } from '@/lib/googleSheets'
  import { cn, normalizeSearchQuery } from '@/lib/utils'
  import { applyColumnOrder, columnOrderStore } from '@/stores/columnOrder'
  import { columnGroupsStore } from '@/stores/columnGroups'
  import type { LessonType } from '@/types/schedule'

  interface MatrixViewProps {
    active: boolean
    source: unknown | null
    groupFilter: string
    search: string
    lessonTypes: LessonType[]
    adapter: MatrixAdapter
  }

  type IdleWindow = Window & {
    requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number
    cancelIdleCallback?: (id: number) => void
  }

  type MatrixSearchWorkerMessage = {
    type: 'rooms-result' | 'teachers-result'
    id: number
    cells: [key: string, entryIndexes: number[] | null][] | null
    matches: ReadonlySet<string> | null
  }

  type HoverSnapshot = {
    target: EventTarget | null
    currentTarget: HTMLElement
    clientX: number
    clientY: number
  }

  type MatrixFilterResult = ReturnType<MatrixAdapter['filter']>

  const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']
  const SEARCH_CACHE_TTL_MS = 30_000
  const WORKER_POST_THROTTLE_MS = 50

  let { active, source, groupFilter, search, lessonTypes, adapter }: MatrixViewProps = $props()
  let tooltip = $state<{ x: number; y: number; entries: unknown[]; column: string } | null>(null)
  let tooltipKey = $state<string | null>(null)
  let draggedColumn = $state<string | null>(null)
  let dragOverColumn = $state<string | null>(null)
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
  let pendingTooltip = $state<{ x: number; y: number; key: string; entries: unknown[]; column: string } | null>(null)
  let pendingHoverEvent: HoverSnapshot | null = null
  let pendingDragPoint: { x: number; y: number } | null = null
  let dragHitCache: MatrixHitTestCache | null = null
  let hoverFrame: number | null = null
  let tooltipFrame: number | null = null
  let dragFrame: number | null = null
  let dropFlashTimer: ReturnType<typeof setTimeout> | null = null
  let matrixWrap: HTMLDivElement | null = $state(null)
  let lessonPress: { x: number; y: number; key: string } | null = null
  let searchWorker: Worker | null = null
  let searchWorkerSource: unknown | null | undefined
  let searchCacheSource: unknown | null | undefined
  let searchCacheKind: string | null = null
  let fallbackSearchCancel: (() => void) | null = null
  let workerRequestCancel: (() => void) | null = null
  let searchRequestId = 0
  let lastWorkerPostAt = 0
  const cellByKeyInternal = new Map<string, MatrixRenderCell>()
  const searchResultCache = new Map<string, { result: MatrixFilterResult; ts: number }>()

  let normalizedSearch = $derived(search ? normalizeSearchQuery(search) : '')
  let cellByKey = $state<Map<string, MatrixRenderCell> | null>(null)
  let columnMatch = $state<ReadonlySet<string> | null>(null)
  let orderedColumns = $derived(applyColumnOrder(source ? adapter.getOrderedColumns(source) : [], $columnOrderStore[adapter.scope]))
  let matrixGroups = $derived($columnGroupsStore[adapter.scope])
  let columnSections = $derived(buildColumnSections(orderedColumns, matrixGroups))
  let columnSlots = $derived(buildColumnSlots(columnSections))
  let highlightColumns = $derived(matchedColumnTokens(columnSlots, columnMatch))
  let hasDimmedColumns = $derived(Boolean(columnMatch))
  let tooltipHeader = $derived(tooltip ? adapter.getTooltipHeader(tooltip.column, tooltip.entries) : null)
  let tooltipBlocks = $derived(tooltip ? adapter.getTooltipBlocks(tooltip.column, tooltip.entries) : [])

  onDestroy(() => {
    cancelHoverFrame()
    hideTooltip()
    if (dragFrame !== null) cancelAnimationFrame(dragFrame)
    if (dropFlashTimer) clearTimeout(dropFlashTimer)
    cancelFallbackSearch()
    cancelWorkerRequest()
    searchWorker?.terminate()
    searchWorker = null
  })

  $effect(() => {
    const isActive = active
    if (!isActive) {
      cancelFallbackSearch()
      cancelWorkerRequest()
      return
    }

    const currentSource = source
    const activeGroup = groupFilter
    const query = normalizedSearch
    const types = lessonTypes
    const requestId = ++searchRequestId
    const cacheKey = buildSearchCacheKey(activeGroup, query, types)
    cancelFallbackSearch()
    cancelWorkerRequest()

    if (!currentSource) {
      cellByKeyInternal.clear()
      cellByKey = null
      columnMatch = null
      return
    }

    refreshSearchCacheScope(currentSource)

    if (activeGroup === 'all' && !query && types.length === 0) {
      cellByKeyInternal.clear()
      cellByKey = null
      columnMatch = null
      return
    }

    const cached = getCachedSearchResult(cacheKey)
    if (cached) {
      applyFilterResult(currentSource, cached)
      return
    }

    if (typeof Worker !== 'undefined') {
      try {
        const worker = getSearchWorker()
        if (searchWorkerSource !== currentSource) {
          searchWorkerSource = currentSource
          worker.postMessage({ type: adapter.kind === 'rooms' ? 'set-rooms-source' : 'set-teachers-source', source: currentSource })
        }
        scheduleWorkerRequest(() => {
          worker.postMessage({
            type: adapter.kind === 'rooms' ? 'run-rooms' : 'run-teachers',
            id: requestId,
            activeGroup,
            query,
            types,
          })
        })
        scheduleFallbackSearch(() => {
          applyFallbackSearch(requestId, currentSource, activeGroup, query, types, cacheKey)
        }, 60)
        return
      } catch {
        searchWorker?.terminate()
        searchWorker = null
        searchWorkerSource = undefined
      }
    }

    scheduleFallbackSearch(() => {
      applyFallbackSearch(requestId, currentSource, activeGroup, query, types, cacheKey)
    })
  })

  function getSearchWorker() {
    if (searchWorker) return searchWorker
    const worker = new Worker(new URL('./matrixWorkerClient.ts', import.meta.url), { type: 'module' })
    const expectedType = adapter.kind === 'rooms' ? 'rooms-result' : 'teachers-result'
    worker.onmessage = (event: MessageEvent<MatrixSearchWorkerMessage>) => {
      const message = event.data
      if (message.type !== expectedType || message.id !== searchRequestId) return
      cancelFallbackSearch()
      applyFilterResult(source, message, getCurrentSearchCacheKey())
    }
    searchWorker = worker
    return worker
  }

  function applyFallbackSearch(
    requestId: number,
    currentSource: unknown,
    activeGroup: string,
    query: string,
    types: LessonType[],
    cacheKey: string,
  ) {
    if (requestId !== searchRequestId) return
    applyFilterResult(currentSource, adapter.filter(currentSource, activeGroup, query, types), cacheKey)
  }

  function applyFilterResult(currentSource: unknown | null, result: MatrixSearchWorkerMessage | MatrixFilterResult, cacheKey?: string) {
    const filterResult: MatrixFilterResult = { cells: result.cells, matches: result.matches }
    if (cacheKey) cacheSearchResult(cacheKey, filterResult)

    if (!currentSource || !filterResult.cells) {
      cellByKeyInternal.clear()
      cellByKey = null
    } else {
      adapter.buildCellMap(currentSource, filterResult.cells, cellByKeyInternal)
      cellByKey = cellByKeyInternal
    }

    columnMatch = filterResult.matches
  }

  function cancelFallbackSearch() {
    fallbackSearchCancel?.()
    fallbackSearchCancel = null
  }

  function cancelWorkerRequest() {
    workerRequestCancel?.()
    workerRequestCancel = null
  }

  function scheduleWorkerRequest(callback: () => void) {
    const elapsed = Date.now() - lastWorkerPostAt
    const delay = Math.max(0, WORKER_POST_THROTTLE_MS - elapsed)
    let cancelled = false

    const run = () => {
      if (cancelled) return
      workerRequestCancel = null
      lastWorkerPostAt = Date.now()
      callback()
    }

    if (delay === 0) {
      run()
      workerRequestCancel = null
      return
    }

    const id = window.setTimeout(run, delay)
    workerRequestCancel = () => {
      cancelled = true
      window.clearTimeout(id)
    }
  }

  function buildSearchCacheKey(activeGroup: string, query: string, types: LessonType[]) {
    return `${adapter.kind}|${activeGroup}|${query}|${types.join(',')}`
  }

  function getCurrentSearchCacheKey() {
    return buildSearchCacheKey(groupFilter, normalizedSearch, lessonTypes)
  }

  function refreshSearchCacheScope(currentSource: unknown) {
    if (searchCacheSource === currentSource && searchCacheKind === adapter.kind) return
    searchCacheSource = currentSource
    searchCacheKind = adapter.kind
    searchResultCache.clear()
  }

  function getCachedSearchResult(key: string) {
    const cached = searchResultCache.get(key)
    if (!cached) return null
    if (Date.now() - cached.ts > SEARCH_CACHE_TTL_MS) {
      searchResultCache.delete(key)
      return null
    }
    return cached.result
  }

  function cacheSearchResult(key: string, result: MatrixFilterResult) {
    searchResultCache.set(key, { result, ts: Date.now() })
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

  function getVisibleCell(column: string, day: string, pair: number): MatrixRenderCell | null {
    if (!source) return null
    if (!cellByKey) return adapter.getCell(source, column, day, pair)
    return cellByKey.get(adapter.slotKey(column, day, pair)) || null
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
    tooltip = { x, y, entries: pendingTooltip.entries, column: pendingTooltip.column }
    pendingTooltip = null
  }

  function queueTooltip(clientX: number, clientY: number, entries: unknown[], column: string, key: string) {
    pendingTooltip = { x: clientX, y: clientY, entries, column, key }
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

  function cancelHoverFrame() {
    if (hoverFrame !== null) cancelAnimationFrame(hoverFrame)
    hoverFrame = null
    pendingHoverEvent = null
  }

  function clearHoverState() {
    cancelHoverFrame()
    hideTooltip()
  }

  function handleTableHover(event: MouseEvent) {
    if (draggedColumn) {
      clearHoverState()
      return
    }

    pendingHoverEvent = {
      target: event.target,
      currentTarget: event.currentTarget as HTMLElement,
      clientX: event.clientX,
      clientY: event.clientY,
    }
    if (hoverFrame !== null) return
    hoverFrame = requestAnimationFrame(flushTableHover)
  }

  function flushTableHover() {
    hoverFrame = null
    const event = pendingHoverEvent
    pendingHoverEvent = null
    if (!event) return

    const target = event.target
    const cell = target instanceof HTMLElement
      ? target.closest('td[data-slot-key]') as HTMLTableCellElement | null
      : null
    if (!cell || !event.currentTarget.contains(cell)) {
      hideTooltip()
      return
    }
    const key = cell.dataset.slotKey
    if (!key) {
      hideTooltip()
      return
    }
    if (key === tooltipKey && tooltip) {
      queueTooltip(event.clientX, event.clientY, tooltip.entries, tooltip.column, key)
      return
    }
    const column = cell.dataset.matrixColumn
    const day = cell.dataset.slotDay
    const pair = Number(cell.dataset.slotPair)
    const visibleCell = column && day && Number.isFinite(pair) ? getVisibleCell(column, day, pair) : null
    const entries = visibleCell ? adapter.getCellEntries(visibleCell) : []
    if (entries.length && column) queueTooltip(event.clientX, event.clientY, entries, column, key)
    else hideTooltip()
  }

  function startLessonPress(event: PointerEvent, key: string) {
    if (event.button !== 0) return
    lessonPress = { x: event.clientX, y: event.clientY, key }
  }

  function finishLessonPress(event: PointerEvent, key: string, cell: MatrixRenderCell) {
    if (!lessonPress || lessonPress.key !== key) return
    const distance = Math.hypot(event.clientX - lessonPress.x, event.clientY - lessonPress.y)
    lessonPress = null
    if (distance > 5) return
    const sheetId = cell.precomputedSheetId
    if (!sheetId) return
    event.preventDefault()
    event.stopPropagation()
    openGoogleSheet(sheetId)
  }

  function cancelLessonPress() {
    lessonPress = null
  }

  function clearColumnDrag() {
    draggedColumn = null
    dragOverColumn = null
    dragOverSide = null
    dragOverGroupId = null
  }

  function flashDropped(column: string) {
    recentlyDropped = column
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
      dragOverColumn = null
      dragOverSide = null
      dragOverGroupId = null
      return
    }
    if (target.type === 'column') {
      dragOverColumn = target.column
      dragOverSide = target.side
      dragOverGroupId = null
      return
    }
    dragOverColumn = null
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

  function startColumnPointer(event: PointerEvent, column: string) {
    if (event.button !== 0) return
    hideTooltip()
    pointerDrag = {
      pointerId: event.pointerId,
      source: column,
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
      draggedColumn = pointerDrag.source
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
    const sourceColumn = pointerDrag.source
    cleanupPointerDrag(event.currentTarget as HTMLElement, event.pointerId)
    if (!target) return
    if (target.type === 'column') commitColumnDrop(sourceColumn, target.column, target.side)
    else commitGroupDrop(sourceColumn, target.groupId)
  }

  function cancelColumnPointer(event: PointerEvent) {
    if (!pointerDrag || event.pointerId !== pointerDrag.pointerId) return
    cleanupPointerDrag(event.currentTarget as HTMLElement, event.pointerId)
  }

  function commitColumnDrop(sourceColumn: string, targetColumn: string, side: MatrixDropSide) {
    if (sourceColumn === targetColumn) return
    runMatrixTransition(() => {
      columnOrderStore.move(adapter.scope, orderedColumns, sourceColumn, targetColumn, side)
      const targetSlot = columnSlots.find((slot) => slot.column === targetColumn)
      if (targetSlot?.groupId) columnGroupsStore.assignItem(adapter.scope, targetSlot.groupId, sourceColumn)
      else columnGroupsStore.unassignItem(adapter.scope, sourceColumn)
    })
    flashDropped(sourceColumn)
  }

  function commitGroupDrop(sourceColumn: string, groupId: string) {
    const group = matrixGroups.find((item) => item.id === groupId)
    const target = group?.items.filter((item) => item !== sourceColumn && orderedColumns.includes(item)).at(-1)
    runMatrixTransition(() => {
      columnGroupsStore.assignItem(adapter.scope, groupId, sourceColumn)
      if (target) columnOrderStore.move(adapter.scope, orderedColumns, sourceColumn, target, 'after')
      else columnOrderStore.moveToEnd(adapter.scope, orderedColumns, sourceColumn)
    })
    flashDropped(sourceColumn)
  }

  function addGroup() {
    const name = prompt(adapter.addGroupPrompt, `Группа ${matrixGroups.length + 1}`)
    if (name === null) return
    columnGroupsStore.addGroup(adapter.scope, name)
  }
</script>

{#if orderedColumns.length === 0}
  <Card contentClass="py-12 text-center">
    <div class="text-sm font-semibold">{adapter.emptyTitle}</div>
    <div class="mt-1 text-sm text-muted-foreground">{adapter.emptyDescription}</div>
  </Card>
{:else}
  <div class={adapter.pageClass}>
    <div class="matrix-groups-toolbar">
      <Button variant="secondary" class="matrix-add-group-button" onclick={addGroup} title={adapter.addGroupTitle} aria-label={adapter.addGroupTitle}>
        <Plus class="h-3.5 w-3.5" />
      </Button>
    </div>

    <div class={adapter.wrapClass} bind:this={matrixWrap}>
      <table
        class={adapter.tableClass}
        data-highlight={highlightColumns || null}
        data-dim={hasDimmedColumns ? 'true' : null}
        onpointermove={handleTableHover}
        onmouseleave={clearHoverState}
      >
        <colgroup>
          <col style="width: 2rem" />
          <col style="width: 2rem" />
          {#each columnSlots as slot, slotIndex (slot.id)}
            <col
              style="width: 20px; min-width: 20px"
              class={cn(
                matrixColumnClass(slotIndex),
                slot.column && columnMatch?.has(slot.column) && 'matrix-col-match',
                slot.column && columnMatch && !columnMatch.has(slot.column) && 'matrix-col-dim',
              )}
            />
          {/each}
        </colgroup>
        <thead>
          <tr class="matrix-group-row">
            <th class="th-day matrix-group-corner" colspan="2">{adapter.groupCornerLabel}</th>
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
                  title={draggedColumn ? `Перетащить «${draggedColumn}» в ${section.name}` : section.name}
                >
                  <span class="matrix-group-head-name">{section.name}</span>
                  <button
                    class="matrix-group-head-delete"
                    type="button"
                    onclick={() => section.groupId && columnGroupsStore.removeGroup(adapter.scope, section.groupId)}
                    title={adapter.deleteGroupTitle}
                    aria-label={`${adapter.deleteGroupTitle}: ${section.name}`}
                  >
                    <Trash2 class="h-3.5 w-3.5" />
                  </button>
                </th>
              {:else}
                <th class="matrix-group-ungrouped" title={adapter.ungroupedTitle}></th>
              {/if}
            {/each}
          </tr>
          <tr class="matrix-column-row">
            <th class="th-day" title="День">Дн</th>
            <th class="th-pair" title="Пара">№</th>
            {#each columnSlots as slot, slotIndex (slot.id)}
              {@const column = slot.column || ''}
              {@const isMatch = column ? columnMatch?.has(column) : false}
              {@const isDim = Boolean(column && columnMatch && !isMatch)}
              {@const labelClass = column ? adapter.getColumnLabelClass(column) : null}
              <th
                class={cn(
                  slot.type === 'group-empty' ? 'matrix-empty-group-slot' : adapter.headerClass,
                  matrixColumnClass(slotIndex),
                  ...adapter.getHeaderClasses(source, column, Boolean(isMatch), isDim),
                  groupSlotClasses(slot),
                  draggedColumn === column && 'matrix-col-dragging',
                  dragOverColumn === column && 'matrix-drag-over-col',
                  dragOverColumn === column && dragOverSide === 'before' && 'matrix-drag-over-before',
                  dragOverColumn === column && dragOverSide === 'after' && 'matrix-drag-over-after',
                  recentlyDropped === column && 'matrix-just-dropped',
                )}
                role={slot.type === 'group-empty' ? 'columnheader' : undefined}
                title={slot.type === 'group-empty' ? adapter.emptyGroupTitle : adapter.getColumnTitle(column)}
                data-matrix-column={column || null}
                data-matrix-group-id={slot.type === 'group-empty' ? slot.groupId : null}
                data-drag-over={slot.type === 'group-empty' && dragOverGroupId === slot.groupId ? 'true' : null}
                aria-grabbed={column ? draggedColumn === column : undefined}
                onpointerdown={(event) => {
                  if (column) startColumnPointer(event, column)
                }}
                onpointermove={moveColumnPointer}
                onpointerup={finishColumnPointer}
                onpointercancel={cancelColumnPointer}
              >
                {#if column}
                  {#if labelClass}
                    <div class={labelClass}>{adapter.getColumnLabel(column)}</div>
                  {:else}
                    {adapter.getColumnLabel(column)}
                  {/if}
                {:else}
                  {adapter.emptyGroupLabel}
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
                    {@const column = slot.column}
                    {@const cell = getVisibleCell(column, day, pair)}
                    {#if !cell}
                      <td
                        class={cn('slot-cell slot-free', matrixColumnClass(slotIndex), ...adapter.getFreeCellClasses(source, column), groupSlotClasses(slot))}
                        data-matrix-column={column}
                      ></td>
                    {:else}
                      {@const cellKey = cell.precomputedKey}
                      {@const entries = cell.entries}
                      {@const hasSheet = cell.precomputedHasSheet}
                      <td
                        class={[
                          'slot-cell slot-busy',
                          matrixColumnClass(slotIndex),
                          ...cell.precomputedBusyClasses,
                          hasSheet && 'slot-clickable',
                          groupSlotClasses(slot),
                        ].filter(Boolean).join(' ')}
                        data-slot-key={cellKey}
                        data-slot-day={day}
                        data-slot-pair={pair}
                        data-matrix-column={column}
                        title={hasSheet ? 'Открыть Google Таблицу' : undefined}
                        onpointerdown={(event) => startLessonPress(event, cellKey)}
                        onpointerup={(event) => finishLessonPress(event, cellKey, cell)}
                        onpointercancel={cancelLessonPress}
                      >
                        <div class="slot-content">
                          <div class={['slot-main', cell.precomputedMainClass].filter(Boolean).join(' ')}>{cell.precomputedMain}</div>
                          {#if cell.precomputedMeta}
                            <div class="slot-meta">{cell.precomputedMeta}</div>
                          {/if}
                        </div>
                        {#each cell.precomputedBadges as badge (`${badge.className}-${badge.title}`)}
                          <span class={badge.className} title={badge.title}>
                            {badge.value}
                          </span>
                        {/each}
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
        class="slot-tooltip pointer-events-none fixed z-50 max-w-sm rounded-lg border border-border px-3.5 py-2.5 text-sm shadow-xl"
        style={`left: 0; top: 0; transform: translate3d(${tooltip.x}px, ${tooltip.y}px, 0)`}
      >
        {#if tooltipHeader}
          <div class={tooltipHeader.className}>{tooltipHeader.text}</div>
        {/if}
        {#each tooltipBlocks as block, idx (block.key)}
          <div>
            {#if idx > 0}
              <hr class="my-1.5 border-border" />
            {/if}
            <div class={block.titleClass}>{block.title}</div>
            {#each block.lines as line, lineIdx (`${block.key}-${lineIdx}`)}
              <div class={line.className}>{line.text}</div>
            {/each}
            {#if block.cancelled}
              <div class="font-semibold text-red-500">Пара отменена</div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </div>
{/if}
