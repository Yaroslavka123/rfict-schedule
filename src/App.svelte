<script lang="ts">
  import { AlertCircle, Loader2 } from '@lucide/svelte'

  import AppShell, { type AppTab } from '@/components/layout/AppShell.svelte'
  import TopFilters from '@/components/layout/TopFilters.svelte'
  import Card from '@/components/ui/Card.svelte'
  import AnalyticsView from '@/features/analytics/AnalyticsView.svelte'
  import RoomsView from '@/features/rooms/RoomsView.svelte'
  import ScheduleView from '@/features/schedule/ScheduleView.svelte'
  import TeachersView from '@/features/teachers/TeachersView.svelte'
  import { ACTIVE_COURSE } from '@/lib/constants'
  import { applyLessonFilters } from '@/lib/schedule'
  import { scheduleStore } from '@/stores/scheduleStore'
  import { themeStore, toggleTheme } from '@/stores/themeStore'
  import type { CourseSelection, FiltersState, WeekSchedule } from '@/types/schedule'

  const defaultFilters: FiltersState = {
    course: ACTIVE_COURSE,
    week: 1,
    group: 'all',
    subgroup: 'all',
    lessonTypes: [],
    search: '',
  }

  let activeTab = $state<AppTab>('rooms')
  let filters = $state<FiltersState>({ ...defaultFilters })
  let debouncedSearch = $state('')
  let autoWeekCourse = $state<CourseSelection | null>(null)

  let schedule = $derived($scheduleStore.schedule)
  let selectedWeeks = $derived($scheduleStore.index.weeksByNumber[filters.week] || [])
  let week = $derived(selectedWeeks[0] || null)
  let selectedWeekLessons = $derived($scheduleStore.index.lessonsByWeek[filters.week] || [])
  let filteredWeekLessons = $derived(
    schedule ? applyLessonFilters(selectedWeekLessons, schedule.groups, filters, debouncedSearch) : [],
  )

  $effect(() => {
    const course = filters.course
    void scheduleStore.fetch(course)
  })

  $effect(() => {
    const search = filters.search
    const timeout = setTimeout(() => {
      debouncedSearch = search
    }, 80)
    return () => clearTimeout(timeout)
  })

  $effect(() => {
    if (!schedule || autoWeekCourse === filters.course) return
    const currentWeek = findCurrentWeek(schedule.weeks)
    autoWeekCourse = filters.course
    if (currentWeek && currentWeek !== filters.week) {
      filters = { ...filters, week: currentWeek }
    }
  })

  $effect(() => {
    if (activeTab !== 'schedule' && filters.group === 'all' && filters.subgroup !== 'all') {
      filters = { ...filters, subgroup: 'all' }
    }
  })

  function setFilters(next: FiltersState) {
    if (next.course !== filters.course) {
      autoWeekCourse = null
    }
    filters = next
  }

  function dayStamp(value: string | null | undefined) {
    if (!value) return null
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return null
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  }

  function findCurrentWeek(weeks: WeekSchedule[]) {
    const today = new Date()
    const todayStamp = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
    const ranges = weeks
      .map((week) => {
        const stamps = week.lessons
          .map((lesson) => dayStamp(lesson.date))
          .filter((stamp): stamp is number => stamp !== null)
        if (stamps.length === 0) return null
        return {
          week: week.week_number,
          start: Math.min(...stamps),
          end: Math.max(...stamps),
        }
      })
      .filter((range): range is { week: number; start: number; end: number } => range !== null)
      .sort((a, b) => a.start - b.start)

    const exact = ranges.find((range) => todayStamp >= range.start && todayStamp <= range.end)
    if (exact) return exact.week
    const future = ranges.find((range) => todayStamp < range.start)
    if (future) return future.week
    return ranges.at(-1)?.week ?? null
  }
</script>

<AppShell
  {activeTab}
  onTabChange={(tab) => (activeTab = tab)}
  theme={$themeStore}
  onToggleTheme={toggleTheme}
  onRefresh={scheduleStore.refresh}
  refreshing={$scheduleStore.loading}
  loadedAt={$scheduleStore.loadedAt}
>
  {#snippet controls()}
    {#if schedule}
      <TopFilters
        {filters}
        groups={schedule.groups}
        weeks={schedule.weeks}
        {activeTab}
        onFiltersChange={setFilters}
      />
    {/if}
  {/snippet}

  {#if $scheduleStore.loading && !schedule}
    <Card contentClass="flex items-center justify-center gap-3 py-16 text-muted-foreground">
      <Loader2 class="h-5 w-5 animate-spin" />
      Загружаю расписание
    </Card>
  {:else if !$scheduleStore.loading && $scheduleStore.error && !schedule}
    <Card contentClass="flex flex-col items-center gap-3 py-16 text-center">
      <AlertCircle class="h-10 w-10 text-destructive" />
      <div>
        <h2 class="text-lg font-semibold">Не удалось загрузить расписание</h2>
        <p class="mt-1 text-sm text-muted-foreground">{$scheduleStore.error}</p>
      </div>
    </Card>
  {:else if schedule}
    <div class:hidden={activeTab !== 'rooms'} class="h-[calc(100vh-var(--header-h)-1.5rem)] min-w-0">
      <RoomsView
        weeks={schedule.weeks}
        groups={schedule.groups}
        selectedWeek={filters.week}
        groupFilter={filters.group}
        search={debouncedSearch}
        lessonTypes={filters.lessonTypes}
      />
    </div>

    <div class:hidden={activeTab !== 'teachers'} class="h-[calc(100vh-var(--header-h)-1.5rem)] min-w-0">
      <TeachersView
        lessons={schedule.lessons}
        groups={schedule.groups}
        search={debouncedSearch}
        lessonTypes={filters.lessonTypes}
        selectedWeek={filters.week}
      />
    </div>

    <div class:hidden={activeTab !== 'analytics'}>
      <AnalyticsView
        course={filters.course}
        groups={schedule.groups}
        lessons={schedule.lessons}
        plans={$scheduleStore.plans}
        flatPlan={$scheduleStore.plan}
        search={debouncedSearch}
        lessonTypes={filters.lessonTypes}
        onPlanChange={scheduleStore.updatePlan}
      />
    </div>

    <div class:hidden={activeTab !== 'schedule'}>
      <ScheduleView
        groups={schedule.groups}
        lessons={filteredWeekLessons}
        weekName={week?.name || `${filters.week}-я неделя`}
        dateRange={week?.date_range || ''}
      />
    </div>
  {/if}
</AppShell>
