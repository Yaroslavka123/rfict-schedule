<script lang="ts">
  import { AlertCircle, Loader2 } from '@lucide/svelte'

  import AppShell, { type AppTab } from '@/components/layout/AppShell.svelte'
  import GlobalFilters from '@/components/layout/GlobalFilters.svelte'
  import Card from '@/components/ui/Card.svelte'
  import AnalyticsView from '@/features/analytics/AnalyticsView.svelte'
  import RoomsView from '@/features/rooms/RoomsView.svelte'
  import ScheduleView from '@/features/schedule/ScheduleView.svelte'
  import TeachersView from '@/features/teachers/TeachersView.svelte'
  import { applyLessonFilters, getWeekByNumber } from '@/lib/schedule'
  import { scheduleStore } from '@/stores/scheduleStore'
  import { themeStore, toggleTheme } from '@/stores/themeStore'
  import type { FiltersState } from '@/types/schedule'

  const defaultFilters: FiltersState = {
    course: 'all',
    week: 1,
    group: 'all',
    subgroup: 'all',
    lessonTypes: [],
    search: '',
  }

  let activeTab = $state<AppTab>('rooms')
  let filters = $state<FiltersState>({ ...defaultFilters })
  let debouncedSearch = $state('')

  let schedule = $derived($scheduleStore.schedule)
  let week = $derived(schedule ? getWeekByNumber(schedule, filters.week) : null)
  let filteredWeekLessons = $derived(
    week && schedule ? applyLessonFilters(week.lessons, schedule.groups, filters, debouncedSearch) : [],
  )

  $effect(() => {
    const course = filters.course
    void scheduleStore.fetch(course)
  })

  $effect(() => {
    const search = filters.search
    const timeout = setTimeout(() => {
      debouncedSearch = search
    }, 300)
    return () => clearTimeout(timeout)
  })

  $effect(() => {
    if (activeTab !== 'schedule' && filters.group === 'all' && filters.subgroup !== 'all') {
      filters = { ...filters, subgroup: 'all' }
    }
  })

  function setFilters(next: FiltersState) {
    filters = next
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
    {#if activeTab === 'rooms'}
      <div class="flex h-[calc(100vh-var(--header-h)-1.5rem)] gap-3">
        <div class="min-w-0 flex-1">
          <RoomsView
            weeks={schedule.weeks}
            groups={schedule.groups}
            selectedWeek={filters.week}
            onWeekChange={(weekNumber) => (filters = { ...filters, week: weekNumber })}
          />
        </div>
        <aside class="hidden w-56 shrink-0 lg:block">
          <GlobalFilters
            {filters}
            groups={schedule.groups}
            weeks={schedule.weeks}
            lessons={schedule.lessons}
            {activeTab}
            onFiltersChange={setFilters}
          />
        </aside>
      </div>
    {:else if activeTab === 'teachers'}
      <div class="flex h-[calc(100vh-var(--header-h)-1.5rem)] gap-3">
        <div class="min-w-0 flex-1">
          <TeachersView
            lessons={schedule.lessons}
            groups={schedule.groups}
            search={debouncedSearch}
            lessonTypes={filters.lessonTypes}
          />
        </div>
        <aside class="hidden w-64 shrink-0 lg:block">
          <GlobalFilters
            {filters}
            groups={schedule.groups}
            weeks={schedule.weeks}
            lessons={schedule.lessons}
            {activeTab}
            onFiltersChange={setFilters}
          />
        </aside>
      </div>
    {:else if activeTab === 'analytics'}
      <div class="grid gap-3 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <AnalyticsView
          course={filters.course}
          groups={schedule.groups}
          lessons={schedule.lessons}
          plans={$scheduleStore.plans}
          flatPlan={$scheduleStore.plan}
          groupFilter={filters.group}
          subgroupFilter={filters.subgroup}
          search={debouncedSearch}
          onPlanChange={scheduleStore.updatePlan}
        />
        <aside class="filter-sidebar lg:sticky lg:top-12 lg:self-start">
          <GlobalFilters
            {filters}
            groups={schedule.groups}
            weeks={schedule.weeks}
            lessons={schedule.lessons}
            {activeTab}
            onFiltersChange={setFilters}
          />
        </aside>
      </div>
    {:else if activeTab === 'schedule'}
      <div class="grid gap-3 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <ScheduleView
          groups={schedule.groups}
          lessons={filteredWeekLessons}
          weekName={week?.name || `${filters.week}-я неделя`}
          dateRange={week?.date_range || ''}
        />
        <aside class="filter-sidebar lg:sticky lg:top-12 lg:self-start">
          <GlobalFilters
            {filters}
            groups={schedule.groups}
            weeks={schedule.weeks}
            lessons={schedule.lessons}
            {activeTab}
            onFiltersChange={setFilters}
          />
        </aside>
      </div>
    {/if}
  {/if}
</AppShell>
