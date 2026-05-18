import { Search, X } from 'lucide-react'
import { useMemo } from 'react'

import type { AppTab } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input, Select } from '@/components/ui/input'
import { COURSES, LESSON_TYPE_LABELS } from '@/lib/constants'
import { getSubgroupsForGroup } from '@/lib/schedule'
import type {
  CourseSelection,
  FiltersState,
  LessonType,
  ScheduleGroup,
  ScheduleGroupWithCourse,
  ScheduleLesson,
  WeekSchedule,
} from '@/types/schedule'

interface GlobalFiltersProps {
  filters: FiltersState
  groups: (ScheduleGroup | ScheduleGroupWithCourse)[]
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
  const showTypes = activeTab === 'schedule' || activeTab === 'teachers' || activeTab === 'rooms'
  const allowAllCourses = true

  const subgroupOptions = useMemo(() => {
    if (filters.group === 'all') return []
    return getSubgroupsForGroup(lessons, filters.group)
  }, [filters.group, lessons])

  const availableWeeks = useMemo(() => weeks.map((week) => week.week_number).sort((a, b) => a - b), [weeks])
  const hasActiveFilters =
    filters.group !== 'all' || filters.subgroup !== 'all' || filters.lessonTypes.length > 0 || filters.search

  return (
    <Card>
      <CardContent className="space-y-3 p-3">
        <FilterRow label="Поиск">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="h-9 pl-9 text-sm"
              placeholder="Предмет, преподаватель…"
              value={filters.search}
              onChange={(event) => setFilter('search', event.target.value)}
            />
          </div>
        </FilterRow>

        <FilterRow label="Курс">
          <Select
            className="h-9 w-full text-sm"
            value={filters.course === 'all' ? 'all' : String(filters.course)}
            onChange={(event) => {
              const raw = event.target.value
              const next: CourseSelection = raw === 'all' ? 'all' : Number(raw)
              onFiltersChange({ ...filters, course: next, group: 'all', subgroup: 'all' })
            }}
          >
            {allowAllCourses && <option value="all">Все курсы</option>}
            {COURSES.map((course) => (
              <option key={course} value={course}>
                {course} курс
              </option>
            ))}
          </Select>
        </FilterRow>

        <FilterRow label="Группа">
          <Select
            className="h-9 w-full text-sm"
            value={filters.group}
            onChange={(event) => setFilter('group', event.target.value)}
          >
            <option value="all">Все группы</option>
            {groups.map((group) => {
              const withCourse = group as ScheduleGroupWithCourse
              return (
                <option key={group.id} value={group.id}>
                  {group.name}
                  {withCourse.course ? ` · ${withCourse.course} курс` : group.department ? ` · ${group.department}` : ''}
                </option>
              )
            })}
          </Select>
        </FilterRow>

        {showSubgroup && subgroupOptions.length > 0 && (
          <FilterRow label="Подгруппа">
            <Select
              className="h-9 w-full text-sm"
              value={filters.subgroup}
              onChange={(event) => setFilter('subgroup', event.target.value)}
            >
              <option value="all">Все</option>
              {subgroupOptions.map((subgroup) => (
                <option key={subgroup} value={subgroup}>
                  {subgroup}
                </option>
              ))}
            </Select>
          </FilterRow>
        )}

        {showWeek && availableWeeks.length > 0 && (
          <FilterRow label="Неделя">
            <div className="flex flex-wrap gap-1">
              {availableWeeks.map((week) => (
                <button
                  key={week}
                  type="button"
                  className={
                    week === filters.week
                      ? 'rounded-md border border-primary bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary'
                      : 'rounded-md border border-border bg-background px-2 py-0.5 text-xs font-semibold text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground'
                  }
                  onClick={() => setFilter('week', week)}
                >
                  {week}
                </button>
              ))}
            </div>
          </FilterRow>
        )}

        {showTypes && (
          <FilterRow label="Тип">
            <div className="flex flex-wrap gap-1">
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
          </FilterRow>
        )}

        {hasActiveFilters && (
          <Button
            variant="ghost"
            className="h-8 w-full text-xs"
            onClick={() => onFiltersChange({ ...filters, group: 'all', subgroup: 'all', lessonTypes: [], search: '' })}
          >
            <X className="h-3.5 w-3.5" />
            Сбросить фильтры
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      {children}
    </div>
  )
}
