import { AlertCircle, Loader2 } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'

import { AppShell, type AppTab } from '@/components/layout/AppShell'
import { GlobalFilters } from '@/components/layout/GlobalFilters'
import { Card, CardContent } from '@/components/ui/card'
import { AnalyticsView } from '@/features/analytics/AnalyticsView'
import { RoomsView } from '@/features/rooms/RoomsView'
import { ScheduleView } from '@/features/schedule/ScheduleView'
import { TeachersView } from '@/features/teachers/TeachersView'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useCoursePlan, useCourseSchedule } from '@/hooks/useSchedule'
import { useTheme } from '@/hooks/useTheme'
import { applyLessonFilters, getWeekByNumber } from '@/lib/schedule'
import type { FiltersState } from '@/types/schedule'

const defaultFilters: FiltersState = {
  course: 1,
  week: 1,
  group: 'all',
  subgroup: 'all',
  lessonTypes: [],
  search: '',
}

export default function App() {
  const { theme, toggleTheme } = useTheme()
  const [activeTab, setActiveTab] = useState<AppTab>('schedule')
  const [filters, setFilters] = useState<FiltersState>(defaultFilters)
  const [refreshKey, setRefreshKey] = useState(0)
  const debouncedSearch = useDebouncedValue(filters.search)
  const { schedule, loading, error, loadedAt } = useCourseSchedule(filters.course, refreshKey)
  const { plan, updateEntry: updatePlanEntry } = useCoursePlan(filters.course, refreshKey)

  const refresh = useCallback(() => setRefreshKey((value) => value + 1), [])

  const week = schedule ? getWeekByNumber(schedule, filters.week) : null

  const filteredWeekLessons = useMemo(() => {
    if (!week || !schedule) return []
    return applyLessonFilters(week.lessons, schedule.groups, filters, debouncedSearch)
  }, [week, schedule, filters, debouncedSearch])

  const filteredAllLessons = useMemo(() => {
    if (!schedule) return []
    return applyLessonFilters(schedule.lessons, schedule.groups, filters, debouncedSearch)
  }, [schedule, filters, debouncedSearch])

  return (
    <AppShell
      activeTab={activeTab}
      onTabChange={setActiveTab}
      theme={theme}
      onToggleTheme={toggleTheme}
      onRefresh={refresh}
      refreshing={loading}
      source={schedule?.source ?? null}
      loadedAt={loadedAt}
    >
      <GlobalFilters
        filters={filters}
        groups={schedule?.groups || []}
        weeks={schedule?.weeks || []}
        lessons={schedule?.lessons || []}
        activeTab={activeTab}
        onFiltersChange={setFilters}
      />

      {loading && !schedule && <LoadingState />}
      {!loading && error && !schedule && <ErrorState error={error} />}
      {schedule && (
        <>
          {activeTab === 'schedule' && (
            <ScheduleView
              groups={schedule.groups}
              lessons={filteredWeekLessons}
              weekName={week?.name || `${filters.week}-я неделя`}
              dateRange={week?.date_range || ''}
            />
          )}
          {activeTab === 'rooms' && (
            <RoomsView weeks={schedule.weeks} groups={schedule.groups} selectedWeek={filters.week} onWeekChange={(week) => setFilters((current) => ({ ...current, week }))} />
          )}
          {activeTab === 'teachers' && <TeachersView lessons={filteredAllLessons} />}
          {activeTab === 'analytics' && (
            <AnalyticsView
              course={schedule.course}
              groups={schedule.groups}
              lessons={schedule.lessons}
              plan={plan}
              onPlanChange={updatePlanEntry}
              groupFilter={filters.group}
            />
          )}
        </>
      )}
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
