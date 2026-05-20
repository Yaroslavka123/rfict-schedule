<script lang="ts">
  import { ExternalLink } from '@lucide/svelte'

  import Card from '@/components/ui/Card.svelte'
  import { DAY_ORDER, LESSON_TYPE_LABELS } from '@/lib/constants'
  import { buildStats, getGoogleSheetUrl, getGroupNameById, getPairRange } from '@/lib/schedule'
  import { cn } from '@/lib/utils'
  import type { ScheduleGroup, ScheduleLesson } from '@/types/schedule'

  interface ScheduleViewProps {
    groups: ScheduleGroup[]
    lessons: ScheduleLesson[]
    weekName: string
    dateRange: string
  }

  let { groups, lessons, weekName, dateRange }: ScheduleViewProps = $props()

  let stats = $derived(buildStats(lessons))
  let byDay = $derived(groupByDay(lessons))
  let populatedDays = $derived(DAY_ORDER.filter((day) => (byDay[day] || []).length > 0))
  let statItems = $derived([
    { label: 'Занятий', value: stats.total, tone: 'default' as const },
    { label: 'Лекций', value: stats.lectures, tone: 'green' as const },
    { label: 'Лаб', value: stats.labs, tone: 'orange' as const },
    { label: 'Практик', value: stats.practices, tone: 'blue' as const },
    { label: 'Отмен', value: stats.cancelled, tone: 'red' as const },
  ])

  function groupByDay(source: ScheduleLesson[]) {
    const grouped: Record<string, ScheduleLesson[]> = {}
    DAY_ORDER.forEach((day) => (grouped[day] = []))
    source.forEach((lesson) => {
      if (!grouped[lesson.day]) grouped[lesson.day] = []
      grouped[lesson.day].push(lesson)
    })
    Object.values(grouped).forEach((list) =>
      list.sort((a, b) => a.pair - b.pair || a.group.localeCompare(b.group, 'ru', { numeric: true })),
    )
    return grouped
  }

  function periodFor(lesson: ScheduleLesson) {
    if (lesson.period_start && lesson.period_end) return `с ${lesson.period_start} по ${lesson.period_end}`
    if (lesson.period_end) return `по ${lesson.period_end}`
    if (lesson.period_start) return `с ${lesson.period_start}`
    return lesson.frequency || ''
  }

  function infoFor(lesson: ScheduleLesson) {
    return [lesson.comment, lesson.frequency && !lesson.subgroup ? lesson.frequency : null].filter(Boolean).join('; ')
  }

  function toneClass(tone: 'default' | 'green' | 'orange' | 'blue' | 'red') {
    return {
      default: 'text-primary',
      green: 'text-emerald-500',
      orange: 'text-amber-500',
      blue: 'text-sky-500',
      red: 'text-red-500',
    }[tone]
  }
</script>

<div class="space-y-3">
  <div class="flex flex-wrap items-center gap-2">
    {#each statItems as stat (stat.label)}
      <div class="flex items-baseline gap-2 rounded-md border border-border bg-card px-3 py-1.5">
        <span class={cn('text-lg font-bold tabular-nums', toneClass(stat.tone))}>{stat.value}</span>
        <span class="text-xs text-muted-foreground">{stat.label}</span>
      </div>
    {/each}
    <span class="ml-auto text-xs text-muted-foreground">
      {weekName}{dateRange ? ` · ${dateRange}` : ''}
    </span>
  </div>

  {#if lessons.length === 0}
    <Card contentClass="py-12 text-center text-muted-foreground">По выбранным фильтрам занятий нет.</Card>
  {:else}
    <div class="overflow-x-auto rounded-lg border border-border bg-card">
      <table class="dense-table">
        <thead>
          <tr>
            <th class="w-12">Пара</th>
            <th class="w-24">Время</th>
            <th class="w-24">Тип</th>
            <th>Предмет</th>
            <th>Преподаватель</th>
            <th class="w-16">Ауд.</th>
            <th>Группа</th>
            <th>Подгруппа</th>
            <th>Период</th>
            <th>Инфо</th>
          </tr>
        </thead>
        <tbody>
          {#each populatedDays as day (day)}
            <tr class="day-header">
              <td colspan="10">{day}</td>
            </tr>
            {#each byDay[day] as lesson, index (`${lesson.day}-${lesson.pair}-${lesson.group}-${lesson.subject}-${lesson.subgroup ?? ''}-${index}`)}
              {@const sheetUrl = getGoogleSheetUrl(lesson)}
              <tr class={lesson.cancelled ? 'opacity-50' : ''}>
                <td class="font-bold">{getPairRange(lesson)}</td>
                <td class="whitespace-nowrap text-muted-foreground">{lesson.time || '—'}</td>
                <td>
                  <span class={cn('type-badge', `type-${lesson.type}`)}>{LESSON_TYPE_LABELS[lesson.type]}</span>
                </td>
                <td class="font-semibold">
                  <div class="flex items-center gap-1.5">
                    <span class={lesson.cancelled ? 'line-through' : ''}>{lesson.subject}</span>
                    {#if sheetUrl}
                      <a
                        class="inline-flex text-muted-foreground transition hover:text-primary"
                        href={sheetUrl}
                        target="_blank"
                        rel="noreferrer"
                        aria-label="Открыть Google Таблицу"
                      >
                        <ExternalLink class="h-3.5 w-3.5" />
                      </a>
                    {/if}
                    {#if lesson.cancelled}
                      <span class="text-xs font-semibold text-red-500">ОТМЕНА</span>
                    {/if}
                  </div>
                </td>
                <td class="text-muted-foreground">{lesson.teacher || '—'}</td>
                <td class="font-semibold text-amber-500">{lesson.room || '—'}</td>
                <td>{getGroupNameById(groups, lesson.group)}</td>
                <td class="text-xs text-purple-400">{lesson.subgroup || ''}</td>
                <td class="text-xs text-muted-foreground">{periodFor(lesson)}</td>
                <td class="text-xs text-muted-foreground">{infoFor(lesson)}</td>
              </tr>
            {/each}
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>
