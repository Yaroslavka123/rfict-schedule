<script lang="ts">
  import { AlertCircle, Loader2 } from '@lucide/svelte'
  import { cubicOut } from 'svelte/easing'

  import AppShell, { type AppTab } from '@/components/layout/AppShell.svelte'
  import TopFilters from '@/components/layout/TopFilters.svelte'
  import Button from '@/components/ui/Button.svelte'
  import Card from '@/components/ui/Card.svelte'
  import AnalyticsView from '@/features/analytics/AnalyticsView.svelte'
  import RoomsView from '@/features/rooms/RoomsView.svelte'
  import ScheduleView from '@/features/schedule/ScheduleView.svelte'
  import TeachersView from '@/features/teachers/TeachersView.svelte'
  import { applyLessonFilters } from '@/lib/schedule'
  import { buildSearchKey, cleanSearchCandidate, normalizeSearchQuery } from '@/lib/utils'
  import { scheduleStore } from '@/stores/scheduleStore'
  import { themeStore, toggleTheme } from '@/stores/themeStore'
  import type {
    CourseSelection,
    FiltersState,
    ScheduleGroup,
    ScheduleGroupWithCourse,
    ScheduleLesson,
    WeekSchedule,
  } from '@/types/schedule'

  const defaultFilters: FiltersState = {
    course: 'all',
    week: 1,
    group: 'all',
    subgroup: 'all',
    lessonTypes: [],
    search: '',
  }
  const SEARCH_DEBOUNCE_MS = 120
  const SEARCH_SUGGESTION_DELAY_MS = 80
  const FETCH_DEBOUNCE_MS = 100

  let activeTab = $state<AppTab>('rooms')
  let renderedTab = $state<AppTab>('rooms')
  let switchingTab = $state<AppTab | null>(null)
  let filters = $state<FiltersState>({ ...defaultFilters })
  let debouncedSearch = $state('')
  let searchSuggestion = $state('')
  let autoWeekCourse = $state<CourseSelection | null>(null)
  let tabSwitchTimer: ReturnType<typeof setTimeout> | null = null

  let schedule = $derived($scheduleStore.schedule)
  let selectedWeeks = $derived($scheduleStore.index.weeksByNumber[filters.week] || [])
  let week = $derived(selectedWeeks[0] || null)
  let selectedWeekLessons = $derived($scheduleStore.index.lessonsByWeek[filters.week] || [])
  let searchCandidates = $derived(
    buildSearchCandidates(
      renderedTab,
      schedule?.groups || [],
      selectedWeekLessons,
      $scheduleStore.index.roomOccupancyByWeek[filters.week]?.orderedRooms || [],
      $scheduleStore.index.teacherOccupancyByWeek[filters.week]?.orderedTeachers || [],
    ),
  )
  let lessonFilters = $derived({
    course: filters.course,
    week: filters.week,
    group: filters.group,
    subgroup: filters.subgroup,
    lessonTypes: filters.lessonTypes,
    search: debouncedSearch,
  })
  let filteredWeekLessons = $derived(
    schedule && renderedTab === 'schedule'
      ? applyLessonFilters(selectedWeekLessons, schedule.groups, lessonFilters, debouncedSearch)
      : [],
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
    let cancelDeferred: (() => void) | null = null
    const timeout = setTimeout(() => {
      cancelDeferred = scheduleDeferred(() => {
        if (!cancelled) debouncedSearch = search
      })
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(timeout)
      cancelDeferred?.()
    }
  })

  $effect(() => {
    const query = filters.search
    const candidates = searchCandidates
    let cancelled = false
    let cancelDeferred: (() => void) | null = null

    if (!query.trim() || candidates.length === 0) {
      searchSuggestion = ''
      return
    }

    const timeout = setTimeout(() => {
      cancelDeferred = scheduleDeferred(() => {
        if (cancelled) return
        searchSuggestion = firstSearchSuggestion(query, candidates)
      })
    }, SEARCH_SUGGESTION_DELAY_MS)

    return () => {
      cancelled = true
      clearTimeout(timeout)
      cancelDeferred?.()
    }
  })

  $effect(() => {
    if (renderedTab === activeTab) return
    let cancelled = false
    const frame = requestAnimationFrame(() => {
      setTimeout(() => {
        if (!cancelled) renderedTab = activeTab
      }, 0)
    })
    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
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

  function setActiveTab(tab: AppTab) {
    if (tab === activeTab) return
    activeTab = tab
    switchingTab = tab
    if (tabSwitchTimer) clearTimeout(tabSwitchTimer)
    tabSwitchTimer = setTimeout(() => {
      renderedTab = tab
      switchingTab = null
      tabSwitchTimer = null
    }, 165)
  }

  function tabViewClass(extra = '') {
    const leaving = switchingTab && switchingTab !== renderedTab ? ' tab-view-leaving' : ''
    return `tab-view${leaving}${extra ? ` ${extra}` : ''}`
  }

  function tabEnter(_node: Element) {
    return {
      duration: 360,
      easing: cubicOut,
      css: (t: number, u: number) =>
        `opacity: ${t}; transform: translate3d(0, ${u * 12}px, 0) scale(${0.996 + t * 0.004});`,
    }
  }

  function tabExit(_node: Element) {
    return {
      duration: 170,
      easing: cubicOut,
      css: (t: number, u: number) =>
        `opacity: ${t}; transform: translate3d(0, ${u * -6}px, 0) scale(${0.998 + t * 0.002});`,
    }
  }

  type IdleWindow = Window & {
    requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number
    cancelIdleCallback?: (id: number) => void
  }

  function scheduleDeferred(callback: () => void) {
    const win = window as IdleWindow
    if (typeof win.requestIdleCallback === 'function') {
      const id = win.requestIdleCallback(callback, { timeout: 180 })
      return () => win.cancelIdleCallback?.(id)
    }
    const frame = requestAnimationFrame(callback)
    return () => cancelAnimationFrame(frame)
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

  interface SearchSuggestionCandidate {
    display: string
    normalized: string
    compact: string
    key: string
  }

  function makeSearchSuggestionCandidate(raw: string | null | undefined): SearchSuggestionCandidate | null {
    const display = cleanSearchCandidate(raw) || String(raw || '').trim()
    if (!display) return null
    const normalized = normalizeSearchQuery(display)
    if (!normalized) return null
    return {
      display,
      normalized,
      compact: normalized.replace(/\s+/g, ''),
      key: buildSearchKey(`${raw || ''} ${display}`),
    }
  }

  function uniqueSearchCandidates(values: (string | null | undefined)[]) {
    const result: SearchSuggestionCandidate[] = []
    const seen = new Set<string>()
    values.forEach((value) => {
      const candidate = makeSearchSuggestionCandidate(value)
      if (!candidate || seen.has(candidate.key)) return
      seen.add(candidate.key)
      result.push(candidate)
    })
    return result
  }

  function firstSearchSuggestion(query: string, candidates: SearchSuggestionCandidate[]) {
    const normalizedQuery = normalizeSearchQuery(query)
    const compactQuery = normalizedQuery.replace(/\s+/g, '')
    if (!normalizedQuery) return ''

    for (const candidate of candidates) {
      if (
        candidate.normalized !== normalizedQuery &&
        (candidate.normalized.startsWith(normalizedQuery) || candidate.compact.startsWith(compactQuery))
      ) {
        return candidate.display
      }
    }
    return ''
  }

  function buildSearchCandidates(
    tab: AppTab,
    groups: (ScheduleGroup | ScheduleGroupWithCourse)[],
    lessons: ScheduleLesson[],
    rooms: string[],
    teachers: string[],
  ) {
    const broadCandidates = [
      ...lessons.map((lesson) => lesson.subject),
      ...lessons.map((lesson) => lesson.teacher),
      ...lessons.map((lesson) => lesson.room),
      ...groups.map((group) => group.name),
    ]
    if (tab === 'teachers') return uniqueSearchCandidates([...teachers, ...broadCandidates])
    if (tab === 'rooms') return uniqueSearchCandidates([...rooms, ...broadCandidates])
    if (tab === 'analytics') {
      return uniqueSearchCandidates([
        ...lessons.map((lesson) => lesson.subject),
        ...groups.map((group) => group.name),
      ])
    }
    return uniqueSearchCandidates(broadCandidates)
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
  onTabChange={setActiveTab}
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
        {searchSuggestion}
        onFiltersChange={setFilters}
      />
    {/if}
  {/snippet}

  {#if $scheduleStore.loading && !schedule}
    <Card contentClass="flex animate-fade-in-up flex-col items-center justify-center gap-3 py-16 text-center" style="animation-delay: 0ms">
      <Loader2 class="h-6 w-6 animate-spin text-primary" />
      <div>
        <div class="text-sm font-semibold">Загружаю расписание</div>
        <div class="mt-1 text-sm text-muted-foreground">Получаю данные по курсам, неделям и план-факту.</div>
      </div>
    </Card>
  {:else if !$scheduleStore.loading && $scheduleStore.error && !schedule}
    <Card contentClass="flex animate-fade-in-up flex-col items-center gap-3 py-16 text-center" style="animation-delay: 0ms">
      <AlertCircle class="h-10 w-10 text-destructive animate-error-shake" />
      <div>
        <h2 class="text-lg font-semibold">Не удалось загрузить расписание</h2>
        <p class="mt-1 text-sm text-muted-foreground">{formatScheduleError($scheduleStore.error)}</p>
      </div>
      <Button variant="secondary" class="h-9" onclick={scheduleStore.refresh}>
        Повторить загрузку
      </Button>
    </Card>
  {:else if schedule}
    {#if renderedTab === 'rooms'}
    <div class={tabViewClass('h-[calc(100vh-var(--header-h)-0.75rem)] min-w-0')} in:tabEnter out:tabExit>
      <RoomsView
        roomData={$scheduleStore.index.roomOccupancyByWeek[filters.week] || null}
        groupFilter={filters.group}
        search={debouncedSearch}
        lessonTypes={filters.lessonTypes}
      />
    </div>
    {:else if renderedTab === 'teachers'}

    <div class={tabViewClass('h-[calc(100vh-var(--header-h)-0.75rem)] min-w-0')} in:tabEnter out:tabExit>
      <TeachersView
        teacherData={$scheduleStore.index.teacherOccupancyByWeek[filters.week] || null}
        groupFilter={filters.group}
        search={debouncedSearch}
        lessonTypes={filters.lessonTypes}
      />
    </div>
    {:else if renderedTab === 'analytics'}

    <div class={tabViewClass()} in:tabEnter out:tabExit>
      <AnalyticsView
        course={filters.course}
        groupFilter={filters.group}
        groups={schedule.groups}
        lessons={schedule.lessons}
        plans={$scheduleStore.plans}
        flatPlan={$scheduleStore.plan}
        search={debouncedSearch}
        lessonTypes={filters.lessonTypes}
        onPlanChange={scheduleStore.updatePlan}
      />
    </div>
    {:else if renderedTab === 'schedule'}

    <div class={tabViewClass()} in:tabEnter out:tabExit>
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
