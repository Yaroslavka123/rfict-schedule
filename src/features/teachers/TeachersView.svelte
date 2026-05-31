<script lang="ts">
  import Card from '@/components/ui/Card.svelte'
  import { LESSON_TYPE_LABELS, PAIRS, PAIR_TIMES } from '@/lib/constants'
  import { cn, normalizeText } from '@/lib/utils'
  import type { TeacherCell, TeacherOccupancyIndex, TeacherSlotEntry } from '@/stores/scheduleStore'
  import type { LessonType } from '@/types/schedule'

  interface TeachersViewProps {
    teacherData: TeacherOccupancyIndex | null
    search: string
    lessonTypes: LessonType[]
  }

  const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']

  let { teacherData, search, lessonTypes }: TeachersViewProps = $props()
  let tooltip = $state<{ x: number; y: number; entries: TeacherSlotEntry[]; teacher: string } | null>(null)
  let tooltipKey = $state<string | null>(null)

  let filteredTeacherData = $derived(filterTeacherData(teacherData, lessonTypes))
  let orderedTeachers = $derived(filteredTeacherData?.orderedTeachers || [])
  let occupancy = $derived(filteredTeacherData?.occupancy || {})
  let tooltipEntriesByKey = $derived(buildTooltipEntriesByKey(filteredTeacherData))
  let normalizedSearch = $derived(normalizeText(search.trim()))
  let teacherMatch = $derived(buildTeacherMatch(teacherData, normalizedSearch))

  function buildTeacherMatch(data: TeacherOccupancyIndex | null, query: string) {
    if (!query) return null
    if (!data) return new Set<string>()
    const matches = new Set<string>()
    data.orderedTeachers.forEach((teacher) => {
      if (normalizeText(teacher).includes(query)) {
        matches.add(teacher)
        return
      }
      const hasEntryMatch = DAYS.some((day) =>
        PAIRS.some((pair) => data.occupancy[teacher]?.[day]?.[pair]?.entries.some((entry) => entry.searchKey.includes(query))),
      )
      if (hasEntryMatch) matches.add(teacher)
    })
    return matches
  }

  function slotKey(teacher: string, day: string, pair: number) {
    return `${encodeURIComponent(teacher)}|${day}|${pair}`
  }

  function buildTooltipEntriesByKey(data: TeacherOccupancyIndex | null) {
    const map = new Map<string, { entries: TeacherSlotEntry[]; teacher: string }>()
    if (!data) return map
    data.orderedTeachers.forEach((teacher) => {
      DAYS.forEach((day) => {
        PAIRS.forEach((pair) => {
          const entries = data.occupancy[teacher]?.[day]?.[pair]?.entries
          if (entries?.length) map.set(slotKey(teacher, day, pair), { entries, teacher })
        })
      })
    })
    return map
  }

  function showTooltip(event: MouseEvent, entries: TeacherSlotEntry[], teacher: string, key: string) {
    tooltipKey = key
    tooltip = {
      x: Math.max(8, Math.min(event.clientX + 12, window.innerWidth - 340)),
      y: Math.max(8, Math.min(event.clientY + 12, window.innerHeight - 260)),
      entries,
      teacher,
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
    const data = tooltipEntriesByKey.get(key)
    if (data) showTooltip(event, data.entries, data.teacher, key)
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

  function filterTeacherData(
    source: TeacherOccupancyIndex | null,
    activeTypes: LessonType[],
  ): TeacherOccupancyIndex | null {
    if (!source) return null
    if (activeTypes.length === 0) return source

    const occupancy: TeacherOccupancyIndex['occupancy'] = {}
    source.orderedTeachers.forEach((teacher) => {
      DAYS.forEach((day) => {
        PAIRS.forEach((pair) => {
          const cell = source.occupancy[teacher]?.[day]?.[pair]
          if (!cell) return
          const entries = cell.entries.filter((entry) => activeTypes.includes(entry.type))
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

</script>

{#if orderedTeachers.length === 0}
  <Card contentClass="py-12 text-center">
    <div class="text-sm font-semibold">Преподаватели не найдены</div>
    <div class="mt-1 text-sm text-muted-foreground">Измените тип занятия или поисковый запрос.</div>
  </Card>
{:else}
  <div class="teachers-page">
    <div class="teachers-matrix-wrap">
      <table class="teachers-matrix" onpointerover={handleTableHover} onmouseleave={hideTooltip}>
        <colgroup>
          <col style="width: 2rem" />
          <col style="width: 2rem" />
          {#each orderedTeachers as teacher (teacher)}
            <col />
          {/each}
        </colgroup>
        <thead>
          <tr>
            <th class="th-day" title="День">Дн</th>
            <th class="th-pair" title="Пара">№</th>
            {#each orderedTeachers as teacher (teacher)}
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
                {#each orderedTeachers as teacher (teacher)}
                  {@const cell = occupancy[teacher]?.[day]?.[pair]}
                  {@const isMatch = teacherMatch?.has(teacher)}
                  {@const isDim = teacherMatch && !isMatch}
                  {#if !cell}
                    <td class={cn('slot-cell slot-free', isDim && 'slot-dim')}></td>
                  {:else}
                    {@const typeClass = cell.allCancelled
                      ? 'slot-cancelled'
                      : cell.types.length > 1
                        ? 'slot-type-multi'
                        : `slot-type-${cell.types[0] || 'unknown'}`}
                    <td
                      class={cn('slot-cell slot-busy', typeClass, isMatch && 'slot-match', isDim && 'slot-dim')}
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
