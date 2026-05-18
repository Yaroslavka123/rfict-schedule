import { AlertCircle, Loader2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { AppShell, type AppTab } from '@/components/layout/AppShell'
import { GlobalFilters } from '@/components/layout/GlobalFilters'
import { Card, CardContent } from '@/components/ui/card'
import { AnalyticsView } from '@/features/analytics/AnalyticsView'
import { RoomsView } from '@/features/rooms/RoomsView'
import { ScheduleView } from '@/features/schedule/ScheduleView'
import { TeachersView } from '@/features/teachers/TeachersView'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useCourseData } from '@/hooks/useSchedule'
import { useTheme } from '@/hooks/useTheme'
import { applyLessonFilters, getWeekByNumber } from '@/lib/schedule'
import type { FiltersState } from '@/types/schedule'

const defaultFilters: FiltersState = {
  course: 'all',
  week: 1,
  group: 'all',
  subgroup: 'all',
  lessonTypes: [],
  search: '',
}

export default function App() {
  const { theme, toggleTheme } = useTheme()
  const [activeTab, setActiveTab] = useState<AppTab>('rooms')
  const [filters, setFilters] = useState<FiltersState>(defaultFilters)
  const [refreshKey, setRefreshKey] = useState(0)
  const debouncedSearch = useDebouncedValue(filters.search)
  const { schedule, plan, plans, loading, error, loadedAt, updatePlanEntry } = useCourseData(
    filters.course,
    refreshKey,
  )

  const refresh = useCallback(() => setRefreshKey((value) => value + 1), [])

  const week = schedule ? getWeekByNumber(schedule, filters.week) : null

  const filteredWeekLessons = useMemo(() => {
    if (!week || !schedule) return []
    return applyLessonFilters(week.lessons, schedule.groups, filters, debouncedSearch)
  }, [week, schedule, filters, debouncedSearch])

  const tabClass = (tab: AppTab) =>
    `tab-panel ${activeTab === tab ? 'tab-panel-active' : 'tab-panel-hidden'}`

  const prevTab = useRef<AppTab>(activeTab)
  useEffect(() => {
    if (activeTab !== 'schedule' && filters.group === 'all' && filters.subgroup !== 'all') {
      setFilters((current) => ({ ...current, subgroup: 'all' }))
    }
    prevTab.current = activeTab
  }, [activeTab, filters.group, filters.subgroup])

  return (
    <AppShell
      activeTab={activeTab}
      onTabChange={setActiveTab}
      theme={theme}
      onToggleTheme={toggleTheme}
      onRefresh={refresh}
      refreshing={loading}
      loadedAt={loadedAt}
    >
      <div
        className={`grid gap-3 transition-[grid-template-columns] duration-300 ease-out ${
          activeTab === 'rooms'
            ? 'lg:grid-cols-[minmax(0,1fr)_16rem]'
            : 'lg:grid-cols-[minmax(0,1fr)_18rem]'
        }`}
      >
        <div className="min-w-0 space-y-3 lg:order-1">
          {loading && !schedule && <LoadingState />}
          {!loading && error && !schedule && <ErrorState error={error} />}
          {schedule && (
            <>
              <div className={tabClass('rooms')} aria-hidden={activeTab !== 'rooms'}>
                <RoomsView
                  weeks={schedule.weeks}
                  groups={schedule.groups}
                  selectedWeek={filters.week}
                  onWeekChange={(week) => setFilters((current) => ({ ...current, week }))}
                />
              </div>
              <div className={tabClass('teachers')} aria-hidden={activeTab !== 'teachers'}>
                <TeachersView
                  lessons={schedule.lessons}
                  groups={schedule.groups}
                  search={debouncedSearch}
                  lessonTypes={filters.lessonTypes}
                />
              </div>
              <div className={tabClass('analytics')} aria-hidden={activeTab !== 'analytics'}>
                <AnalyticsView
                  course={filters.course}
                  groups={schedule.groups}
                  lessons={schedule.lessons}
                  plans={plans}
                  flatPlan={plan}
                  onPlanChange={updatePlanEntry}
                  groupFilter={filters.group}
                  subgroupFilter={filters.subgroup}
                  search={debouncedSearch}
                />
              </div>
              <div className={tabClass('schedule')} aria-hidden={activeTab !== 'schedule'}>
                <ScheduleView
                  groups={schedule.groups}
                  lessons={filteredWeekLessons}
                  weekName={week?.name || `${filters.week}-я неделя`}
                  dateRange={week?.date_range || ''}
                />
              </div>
            </>
          )}
        </div>
        <aside className="filter-sidebar lg:order-2 lg:sticky lg:top-12 lg:self-start">
          <GlobalFilters
            filters={filters}
            groups={schedule?.groups || []}
            weeks={schedule?.weeks || []}
            lessons={schedule?.lessons || []}
            activeTab={activeTab}
            onFiltersChange={setFilters}
          />
        </aside>
      </div>
    </AppShell>
  )
}

function LoadingState() {
  return (
    <Card>
      <CardContent className="flex items-center justify-center gap-3 py-16 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        Загружаю расписание
      </CardContent>
    </Card>
  )
}

function ErrorState({ error }: { error: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
        <AlertCircle className="h-10 w-10 text-destructive" />
        <div>
          <h2 className="text-lg font-semibold">Не удалось загрузить расписание</h2>
          <p className="mt-1 text-sm text-muted-foreground">{error}</p>
        </div>
      </CardContent>
    </Card>
  )
}
