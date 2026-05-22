<script lang="ts">
  import { AlertCircle, Loader2 } from '@lucide/svelte'

  import AppShell, { type AppTab } from '@/components/layout/AppShell.svelte'
  import TopFilters from '@/components/layout/TopFilters.svelte'
  import Button from '@/components/ui/Button.svelte'
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
  const SEARCH_DEBOUNCE_MS = 200
  const FETCH_DEBOUNCE_MS = 100

  let activeTab = $state<AppTab>('schedule')
  let filters = $state<FiltersState>({ ...defaultFilters })
  let debouncedSearch = $state('')
  let autoWeekCourse = $state<CourseSelection | null>(null)

  let schedule = $derived($scheduleStore.schedule)
  let selectedWeeks = $derived($scheduleStore.index.weeksByNumber[filters.week] || [])
  let week = $derived(selectedWeeks[0] || null)
  let selectedWeekLessons = $derived($scheduleStore.index.lessonsByWeek[filters.week] || [])
  let lessonFilters = $derived({
    course: filters.course,
    week: filters.week,
    group: filters.group,
    subgroup: filters.subgroup,
    lessonTypes: filters.lessonTypes,
    search: debouncedSearch,
  })
  let filteredWeekLessons = $derived(
    schedule ? applyLessonFilters(selectedWeekLessons, schedule.groups, lessonFilters, debouncedSearch) : [],
  )

  $effect(() => {
    const course = filters.course
    const timeout = setTimeout(() => {
      void scheduleStore.fetch(course)
    }, FETCH_DEBOUNCE_MS)
    return () => clearTimeout(timeout)
  })

  $effect(() => {
    const search = filters.search
    let cancelled = false
    const timeout = setTimeout(() => {
      requestAnimationFrame(() => {
        if (cancelled) return
        setTimeout(() => {
          if (!cancelled) debouncedSearch = search
        }, 0)
      })
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(timeout)
    }
  })

  $effect(() => {
    if (!schedule || autoWeekCourse === filters.course) return
    const availableWeeks = Array.from(new Set(schedule.weeks.map((entry) => entry.week_number))).sort((a, b) => a - b)
    const currentWeek = findCurrentWeek(schedule.weeks) || availableWeeks[0] || null
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

  function formatScheduleError(error: string | null) {
    if (!error) return 'Проверьте соединение и попробуйте еще раз.'
    if (error === 'Failed to fetch') {
      return 'Не удалось соединиться с API. Проверьте доступность backend и настройки CORS.'
    }
    return error
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
    <Card contentClass="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <Loader2 class="h-6 w-6 animate-spin text-primary" />
      <div>
        <div class="text-sm font-semibold">Загружаю расписание</div>
        <div class="mt-1 text-sm text-muted-foreground">Получаю данные по курсам, неделям и план-факту.</div>
      </div>
    </Card>
  {:else if !$scheduleStore.loading && $scheduleStore.error && !schedule}
    <Card contentClass="flex flex-col items-center gap-3 py-16 text-center">
      <AlertCircle class="h-10 w-10 text-destructive" />
      <div>
        <h2 class="text-lg font-semibold">Не удалось загрузить расписание</h2>
        <p class="mt-1 text-sm text-muted-foreground">{formatScheduleError($scheduleStore.error)}</p>
      </div>
      <Button variant="secondary" class="h-9" onclick={scheduleStore.refresh}>
        Повторить загрузку
      </Button>
    </Card>
  {:else if schedule}
    {#if activeTab === 'rooms'}
    <div class="h-[calc(100vh-var(--header-h)-1.5rem)] min-w-0">
      <RoomsView
        roomData={$scheduleStore.index.roomOccupancyByWeek[filters.week] || null}
        groupFilter={filters.group}
        search={debouncedSearch}
        lessonTypes={filters.lessonTypes}
      />
    </div>
    {:else if activeTab === 'teachers'}

    <div class="h-[calc(100vh-var(--header-h)-1.5rem)] min-w-0">
      <TeachersView
        teacherData={$scheduleStore.index.teacherOccupancyByWeek[filters.week] || null}
        search={debouncedSearch}
        lessonTypes={filters.lessonTypes}
      />
    </div>
    {:else if activeTab === 'analytics'}

    <div>
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
    {:else if activeTab === 'schedule'}

    <div>
      <ScheduleView
        groups={schedule.groups}
        lessons={filteredWeekLessons}
        weekName={week?.name || `${filters.week}-я неделя`}
        dateRange={week?.date_range || ''}
      />
    </div>
    {/if}
  {/if}
</AppShell>
