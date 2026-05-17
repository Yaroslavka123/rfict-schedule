import { AlertCircle, Database, Github, Loader2, RefreshCw } from 'lucide-react'
import { useMemo, useState } from 'react'

import { AppShell, type AppTab } from '@/components/layout/AppShell'
import { GlobalFilters } from '@/components/layout/GlobalFilters'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { AnalyticsView } from '@/features/analytics/AnalyticsView'
import { RoomsView } from '@/features/rooms/RoomsView'
import { ScheduleView } from '@/features/schedule/ScheduleView'
import { TeachersView } from '@/features/teachers/TeachersView'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useSchedule } from '@/hooks/useSchedule'
import { useTheme } from '@/hooks/useTheme'
import { applyLessonFilters } from '@/lib/schedule'
import { formatUpdatedAt } from '@/lib/utils'
import type { FiltersState } from '@/types/schedule'

const defaultFilters: FiltersState = {
  course: 1,
  week: 1,
  group: 'all',
  lessonTypes: [],
  search: '',
}

export default function App() {
  const { theme, toggleTheme } = useTheme()
  const [activeTab, setActiveTab] = useState<AppTab>('schedule')
  const [filters, setFilters] = useState<FiltersState>(defaultFilters)
  const debouncedSearch = useDebouncedValue(filters.search)
  const { schedule, source, loading, error } = useSchedule(filters.course, filters.week)

  const filteredLessons = useMemo(() => {
    if (!schedule) return []
    return applyLessonFilters(schedule, filters, debouncedSearch)
  }, [schedule, filters, debouncedSearch])

  return (
    <AppShell activeTab={activeTab} onTabChange={setActiveTab} theme={theme} onToggleTheme={toggleTheme}>
      <Hero />
      <GlobalFilters filters={filters} groups={schedule?.groups || []} onFiltersChange={setFilters} />

      {loading && <LoadingState />}
      {!loading && error && <ErrorState error={error} />}
      {!loading && schedule && (
        <>
          <DataStatus scheduleName={schedule.name} updatedAt={schedule.generated_at} source={source} total={filteredLessons.length} />
          {activeTab === 'schedule' && <ScheduleView schedule={schedule} lessons={filteredLessons} />}
          {activeTab === 'rooms' && <RoomsView lessons={filteredLessons} />}
          {activeTab === 'teachers' && <TeachersView lessons={filteredLessons} />}
          {activeTab === 'analytics' && <AnalyticsView schedule={{ ...schedule, lessons: filteredLessons }} />}
        </>
      )}
    </AppShell>
  )
}

function Hero() {
  return (
    <section className="overflow-hidden rounded-3xl border border-border bg-hero p-6 shadow-card md:p-8">
      <div className="max-w-3xl">
        <Badge tone="blue">React MVP · backend-ready · JSON fallback</Badge>
        <h2 className="mt-4 text-3xl font-black tracking-tight md:text-5xl">Быстрое расписание для методистов и администраторов</h2>
        <p className="mt-4 text-base leading-7 text-muted-foreground md:text-lg">
          Один интерфейс для занятий, кабинетов, преподавателей и план-факт аналитики. Сейчас работает на текущих JSON, а при появлении API переключится без переписывания UI.
        </p>
      </div>
    </section>
  )
}

function DataStatus({ scheduleName, updatedAt, source, total }: { scheduleName: string; updatedAt: string; source: string | null; total: number }) {
  const SourceIcon = source === 'backend' ? Database : Github
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-semibold">{scheduleName}</h2>
            <Badge tone={source === 'backend' ? 'green' : 'purple'}>
              <SourceIcon className="mr-1 h-3 w-3" />
              {source === 'backend' ? 'Backend API' : 'JSON fallback'}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{formatUpdatedAt(updatedAt)} · найдено занятий: {total}</p>
        </div>
        <Button variant="secondary" onClick={() => window.location.reload()}><RefreshCw className="h-4 w-4" />Обновить</Button>
      </CardContent>
    </Card>
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
