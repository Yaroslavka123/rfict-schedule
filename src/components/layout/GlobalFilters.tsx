import { Search, X } from 'lucide-react'
import { useMemo } from 'react'

import type { AppTab } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input, Select } from '@/components/ui/input'
import { COURSES, LESSON_TYPE_LABELS } from '@/lib/constants'
import { getSubgroupsForGroup } from '@/lib/schedule'
import type { FiltersState, LessonType, ScheduleGroup, ScheduleLesson, WeekSchedule } from '@/types/schedule'

interface GlobalFiltersProps {
  filters: FiltersState
  groups: ScheduleGroup[]
  weeks: WeekSchedule[]
  lessons: ScheduleLesson[]
  activeTab: AppTab
  onFiltersChange: (filters: FiltersState) => void
}

const filterableTypes = Object.entries(LESSON_TYPE_LABELS).filter(([type]) => type !== 'unknown') as [LessonType, string][]

export function GlobalFilters({ filters, groups, weeks, lessons, activeTab, onFiltersChange }: GlobalFiltersProps) {
  const setFilter = <K extends keyof FiltersState>(key: K, value: FiltersState[K]) => {
    if (key === 'group') {
      onFiltersChange({ ...filters, group: value as string, subgroup: 'all' })
      return
    }
    onFiltersChange({ ...filters, [key]: value })
  }

  const toggleType = (type: LessonType) => {
    const enabled = filters.lessonTypes.includes(type)
    setFilter('lessonTypes', enabled ? filters.lessonTypes.filter((current) => current !== type) : [...filters.lessonTypes, type])
  }

  const showWeek = activeTab === 'schedule' || activeTab === 'rooms'
  const showSubgroup = filters.group !== 'all' && activeTab !== 'rooms'
  const showTypes = activeTab === 'schedule' || activeTab === 'teachers'

  const subgroupOptions = useMemo(() => {
    if (filters.group === 'all') return []
    return getSubgroupsForGroup(lessons, filters.group)
  }, [filters.group, lessons])

  const availableWeeks = useMemo(() => weeks.map((week) => week.week_number).sort((a, b) => a - b), [weeks])

  return (
    <Card>
      <CardContent className="space-y-3 p-3 md:p-4">
        <div className="flex flex-wrap items-center gap-2">
          <FilterLabel>Курс</FilterLabel>
          <Select className="h-9 w-auto min-w-[7rem]" value={filters.course} onChange={(event) => onFiltersChange({ ...filters, course: Number(event.target.value), group: 'all', subgroup: 'all' })}>
            {COURSES.map((course) => (
              <option key={course} value={course}>{course} курс</option>
            ))}
          </Select>

          <FilterLabel>Группа</FilterLabel>
          <Select className="h-9 w-auto min-w-[10rem]" value={filters.group} onChange={(event) => setFilter('group', event.target.value)}>
            <option value="all">Все группы</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
                {group.department ? ` · ${group.department}` : ''}
              </option>
            ))}
          </Select>

          {showSubgroup && subgroupOptions.length > 0 && (
            <>
              <FilterLabel>Подгр.</FilterLabel>
              <Select className="h-9 w-auto min-w-[6rem]" value={filters.subgroup} onChange={(event) => setFilter('subgroup', event.target.value)}>
                <option value="all">Все</option>
                {subgroupOptions.map((subgroup) => (
                  <option key={subgroup} value={subgroup}>{subgroup}</option>
                ))}
              </Select>
            </>
          )}

          <div className="relative ml-auto min-w-[14rem] flex-1 max-w-md">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="h-9 pl-9" placeholder="Поиск: предмет, преподаватель, кабинет…" value={filters.search} onChange={(event) => setFilter('search', event.target.value)} />
          </div>

          {(filters.group !== 'all' || filters.subgroup !== 'all' || filters.lessonTypes.length > 0 || filters.search) && (
            <Button variant="ghost" className="h-9" onClick={() => onFiltersChange({ ...filters, group: 'all', subgroup: 'all', lessonTypes: [], search: '' })}>
              <X className="h-4 w-4" />
              Сброс
            </Button>
          )}
        </div>

        {showWeek && availableWeeks.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <FilterLabel>Неделя</FilterLabel>
            {availableWeeks.map((week) => (
              <button
                key={week}
                type="button"
                className={
                  week === filters.week
                    ? 'rounded-md border border-primary bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary'
                    : 'rounded-md border border-border bg-background px-2.5 py-1 text-xs font-semibold text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground'
                }
                onClick={() => setFilter('week', week)}
              >
                {week}-я
              </button>
            ))}
          </div>
        )}

        {showTypes && (
          <div className="flex flex-wrap gap-1.5">
            {filterableTypes.map(([type, label]) => (
              <button
                key={type}
                type="button"
                className={filters.lessonTypes.includes(type) ? 'filter-chip filter-chip-active' : 'filter-chip'}
                onClick={() => toggleType(type)}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function FilterLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{children}</span>
}
