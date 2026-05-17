import { Filter, Search, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input, Select } from '@/components/ui/input'
import { COURSES, LESSON_TYPE_LABELS, WEEKS } from '@/lib/constants'
import type { FiltersState, LessonType, ScheduleGroup } from '@/types/schedule'

interface GlobalFiltersProps {
  filters: FiltersState
  groups: ScheduleGroup[]
  onFiltersChange: (filters: FiltersState) => void
}

const filterableTypes = Object.entries(LESSON_TYPE_LABELS).filter(([type]) => type !== 'unknown') as [LessonType, string][]

export function GlobalFilters({ filters, groups, onFiltersChange }: GlobalFiltersProps) {
  const setFilter = <K extends keyof FiltersState>(key: K, value: FiltersState[K]) => {
    onFiltersChange({ ...filters, [key]: value })
  }

  const toggleType = (type: LessonType) => {
    const enabled = filters.lessonTypes.includes(type)
    setFilter('lessonTypes', enabled ? filters.lessonTypes.filter((current) => current !== type) : [...filters.lessonTypes, type])
  }

  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
            <Filter className="h-4 w-4" />
            Фильтры
          </div>
          <div className="grid flex-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Select value={filters.course} onChange={(event) => setFilter('course', Number(event.target.value))}>
              {COURSES.map((course) => (
                <option key={course} value={course}>{course} курс</option>
              ))}
            </Select>
            <Select value={filters.week} onChange={(event) => setFilter('week', Number(event.target.value))}>
              {WEEKS.map((week) => (
                <option key={week} value={week}>{week}-я неделя</option>
              ))}
            </Select>
            <Select value={filters.group} onChange={(event) => setFilter('group', event.target.value)}>
              <option value="all">Все группы</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>{group.name}</option>
              ))}
            </Select>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
              <Input className="pl-9" placeholder="Поиск по расписанию" value={filters.search} onChange={(event) => setFilter('search', event.target.value)} />
            </div>
          </div>
          <Button variant="ghost" onClick={() => onFiltersChange({ ...filters, group: 'all', lessonTypes: [], search: '' })}>
            <X className="h-4 w-4" />
            Сбросить
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {filterableTypes.map(([type, label]) => (
            <button
              key={type}
              className={filters.lessonTypes.includes(type) ? 'filter-chip filter-chip-active' : 'filter-chip'}
              onClick={() => toggleType(type)}
            >
              {label}
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
