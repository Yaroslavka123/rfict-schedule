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
  import type { TeacherCell, TeacherOccupancyIndex, TeacherSlotEntry } from '@/stores/scheduleStore'
  import type { LessonType } from '@/types/schedule'

  interface TeachersViewProps {
    teacherData: TeacherOccupancyIndex | null
    groupFilter: string
    search: string
    lessonTypes: LessonType[]
  }

  const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']

  let { teacherData, groupFilter, search, lessonTypes }: TeachersViewProps = $props()
  let tooltip = $state<{ x: number; y: number; entries: TeacherSlotEntry[]; teacher: string } | null>(null)
  let tooltipKey = $state<string | null>(null)
  let draggedTeacher = $state<string | null>(null)
  let dragOverTeacher = $state<string | null>(null)
  let dragOverGroupId = $state<string | null>(null)
  let recentlyDropped = $state<string | null>(null)
  let pendingTooltip = $state<{ x: number; y: number; key: string; entries: TeacherSlotEntry[]; teacher: string } | null>(null)
  let tooltipFrame: number | null = null
  let dropFlashTimer: ReturnType<typeof setTimeout> | null = null

  let filteredTeacherData = $derived(filterTeacherData(teacherData, groupFilter, lessonTypes))
  let orderedTeachers = $derived(applyColumnOrder(filteredTeacherData?.orderedTeachers || [], $columnOrderStore.teachers))
  let teacherGroups = $derived($columnGroupsStore.teachers)
  let columnSections = $derived(buildColumnSections(orderedTeachers, teacherGroups))
  let columnSlots = $derived(buildColumnSlots(columnSections))
  let occupancy = $derived(filteredTeacherData?.occupancy || {})
  let tooltipEntriesByKey = $derived(buildTooltipEntriesByKeyFromSlots(columnSlots, occupancy))
  let normalizedSearch = $derived(normalizeSearchQuery(search.trim()))
  let teacherMatch = $derived(buildTeacherMatch(filteredTeacherData, normalizedSearch))

  function buildTeacherMatch(data: TeacherOccupancyIndex | null, query: string) {
    if (!query) return null
    if (!data) return new Set<string>()
    const matches = new Set<string>()
    data.orderedTeachers.forEach((teacher) => {
      if ((data.searchKeyByTeacher[teacher] || '').includes(query)) matches.add(teacher)
    })
    return matches
  }

  function slotKey(teacher: string, day: string, pair: number) {
    return `${encodeURIComponent(teacher)}|${day}|${pair}`
  }

  function buildTooltipEntriesByKeyFromSlots(
    slots: ReturnType<typeof buildColumnSlots>,
    source: TeacherOccupancyIndex['occupancy'],
  ) {
    const map = new Map<string, { entries: TeacherSlotEntry[]; teacher: string }>()
    slots.forEach((slot) => {
      if (!slot.column) return
      const teacher = slot.column
      DAYS.forEach((day) => {
        PAIRS.forEach((pair) => {
          const entries = source[teacher]?.[day]?.[pair]?.entries
          if (entries?.length) map.set(slotKey(teacher, day, pair), { entries, teacher })
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
    const data = tooltipEntriesByKey.get(key)
    if (data) queueTooltip(event, data.entries, data.teacher, key)
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

  function entryMatches(entry: TeacherSlotEntry, activeGroup: string, types: LessonType[]) {
    if (activeGroup !== 'all' && entry.groupId !== activeGroup) return false
    if (types.length > 0 && !types.includes(entry.type)) return false
    return true
  }

  function filterTeacherData(
    source: TeacherOccupancyIndex | null,
    activeGroup: string,
    activeTypes: LessonType[],
  ): TeacherOccupancyIndex | null {
    if (!source) return null
    if (activeGroup === 'all' && activeTypes.length === 0) return source

    const occupancy: TeacherOccupancyIndex['occupancy'] = {}
    source.orderedTeachers.forEach((teacher) => {
      DAYS.forEach((day) => {
        PAIRS.forEach((pair) => {
          const cell = source.occupancy[teacher]?.[day]?.[pair]
          if (!cell) return
          const entries = cell.entries.filter((entry) => entryMatches(entry, activeGroup, activeTypes))
          if (entries.length === 0) return
          if (!occupancy[teacher]) occupancy[teacher] = {}
          if (!occupancy[teacher][day]) occupancy[teacher][day] = {}
          occupancy[teacher][day][pair] = summarizeTeacherEntries(entries)
        })
      })
    })

    return {
      orderedTeachers: source.orderedTeachers,
      occupancy,
      searchKeyByTeacher: source.searchKeyByTeacher,
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

  function shortTeacherName(full: string): string {
    const trimmed = full.trim()
    if (trimmed.length <= 22) return trimmed
    return `${trimmed.slice(0, 21)}...`
  }

  function clearColumnDrag() {
    draggedTeacher = null
    dragOverTeacher = null
    dragOverGroupId = null
  }

  function flashDropped(teacher: string) {
    recentlyDropped = teacher
    if (dropFlashTimer) clearTimeout(dropFlashTimer)
    dropFlashTimer = setTimeout(() => {
      recentlyDropped = null
      dropFlashTimer = null
    }, 220)
  }

  function startColumnDrag(event: DragEvent, teacher: string) {
    hideTooltip()
    draggedTeacher = teacher
    event.dataTransfer?.setData('text/plain', teacher)
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move'
      setColumnDragImage(event, teacher)
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

  function allowColumnDrop(event: DragEvent, teacher?: string) {
    if (!draggedTeacher) return
    if (teacher && draggedTeacher === teacher) {
      dragOverTeacher = null
      dragOverGroupId = null
      return
    }
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    if (teacher) {
      if (dragOverTeacher !== teacher) dragOverTeacher = teacher
      if (dragOverGroupId !== null) dragOverGroupId = null
    } else {
      // hovering over a group zone (header or empty slot)
      if (dragOverTeacher !== null) dragOverTeacher = null
    }
  }

  function clearColumnHover(teacher: string) {
    if (dragOverTeacher === teacher) dragOverTeacher = null
  }

  function allowGroupDrop(event: DragEvent, groupId: string | undefined) {
    if (!draggedTeacher || !groupId) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    if (dragOverGroupId !== groupId) dragOverGroupId = groupId
    if (dragOverTeacher !== null) dragOverTeacher = null
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

  function dropColumn(event: DragEvent, teacher: string) {
    event.preventDefault()
    const source = draggedTeacher || event.dataTransfer?.getData('text/plain')
    if (source && source !== teacher) {
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
      const side = event.clientX < rect.left + rect.width / 2 ? 'before' : 'after'
      columnOrderStore.move('teachers', orderedTeachers, source, teacher, side)
      const targetSlot = columnSlots.find((slot) => slot.column === teacher)
      if (targetSlot?.groupId) columnGroupsStore.assignItem('teachers', targetSlot.groupId, source)
      else columnGroupsStore.unassignItem('teachers', source)
      flashDropped(source)
    }
    clearColumnDrag()
  }

  function dropTeacherOnGroup(groupId: string) {
    if (!draggedTeacher) return
    const source = draggedTeacher
    const group = teacherGroups.find((item) => item.id === groupId)
    const target = group?.items.filter((item) => item !== source && orderedTeachers.includes(item)).at(-1)
    columnGroupsStore.assignItem('teachers', groupId, source)
    if (target) columnOrderStore.move('teachers', orderedTeachers, source, target, 'after')
    else columnOrderStore.moveToEnd('teachers', orderedTeachers, source)
    flashDropped(source)
    clearColumnDrag()
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
      <Button variant="secondary" class="h-8 px-2.5 text-xs" onclick={addTeacherGroup} title="Создать группу преподавателей">
        <Plus class="h-3.5 w-3.5" />
        Группа
      </Button>
    </div>

    <div class="teachers-matrix-wrap">
      <table class="teachers-matrix" onpointermove={handleTableHover} onmouseleave={hideTooltip}>
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
                    if (section.groupId) dropTeacherOnGroup(section.groupId)
                  }}
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
            {#each columnSlots as slot (slot.id)}
              {#if slot.type === 'group-empty'}
                <th
                  class={cn('matrix-empty-group-slot', groupSlotClasses(slot))}
                  role="columnheader"
                  title="Перетащите преподавателя в группу"
                  data-drag-over={dragOverGroupId === slot.groupId ? 'true' : null}
                  ondragover={(event) => allowGroupDrop(event, slot.groupId)}
                  ondragleave={() => clearGroupHover(slot.groupId)}
                  ondrop={(event) => {
                    event.preventDefault()
                    if (slot.groupId) dropTeacherOnGroup(slot.groupId)
                  }}
                >
                  Перетащите
                </th>
              {:else if slot.column}
              {@const teacher = slot.column}
              {@const isMatch = teacherMatch?.has(teacher)}
              {@const isDim = teacherMatch && !isMatch}
              <th
                class={cn(
                  'th-teacher matrix-draggable-header',
                  isMatch && 'th-teacher-match',
                  isDim && 'th-teacher-dim',
                  groupSlotClasses(slot),
                  draggedTeacher === teacher && 'matrix-col-dragging',
                  dragOverTeacher === teacher && 'matrix-drag-over-col',
                  recentlyDropped === teacher && 'matrix-just-dropped',
                )}
                title={teacher}
                draggable="true"
                aria-grabbed={draggedTeacher === teacher}
                ondragstart={(event) => startColumnDrag(event, teacher)}
                ondragover={(event) => allowColumnDrop(event, teacher)}
                ondragleave={() => clearColumnHover(teacher)}
                ondrop={(event) => dropColumn(event, teacher)}
                ondragend={clearColumnDrag}
              >
                <div class="th-teacher-label">{shortTeacherName(teacher)}</div>
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
                        if (slot.groupId) dropTeacherOnGroup(slot.groupId)
                      }}
                    ></td>
                  {:else if slot.column}
                  {@const teacher = slot.column}
                  {@const cell = occupancy[teacher]?.[day]?.[pair]}
                  {@const isMatch = teacherMatch?.has(teacher)}
                  {@const isDim = teacherMatch && !isMatch}
                  {#if !cell}
                    <td class={cn('slot-cell slot-free', isDim && 'slot-dim', groupSlotClasses(slot))}></td>
                  {:else}
                    {@const typeClass = cell.allCancelled
                      ? 'slot-cancelled'
                      : cell.types.length > 1
                        ? 'slot-type-multi'
                        : `slot-type-${cell.types[0] || 'unknown'}`}
                    <td
                      class={cn('slot-cell slot-busy', typeClass, isMatch && 'slot-match', isDim && 'slot-dim', groupSlotClasses(slot))}
                      data-slot-key={slotKey(teacher, day, pair)}
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

    {#if tooltip}
      <div
        class="slot-tooltip pointer-events-none fixed z-50 max-w-xs rounded-lg border border-border px-3 py-2 text-xs shadow-xl"
        style={`left: 0; top: 0; transform: translate3d(${tooltip.x}px, ${tooltip.y}px, 0)`}
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
