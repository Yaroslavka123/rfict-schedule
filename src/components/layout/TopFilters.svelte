<script lang="ts">
  import { Search, X } from '@lucide/svelte'

  import Button from '@/components/ui/Button.svelte'
  import FilterSelect, { type FilterSelectOption } from '@/components/ui/FilterSelect.svelte'
  import Input from '@/components/ui/Input.svelte'
  import type { AppTab } from '@/components/layout/AppShell.svelte'
  import { COURSES, LESSON_TYPE_LABELS } from '@/lib/constants'
  import { normalizeSearchQuery } from '@/lib/utils'
  import type {
    CourseSelection,
    FiltersState,
    LessonType,
    ScheduleGroup,
    ScheduleGroupWithCourse,
    WeekSchedule,
  } from '@/types/schedule'

  interface TopFiltersProps {
    filters: FiltersState
    groups: (ScheduleGroup | ScheduleGroupWithCourse)[]
    weeks: WeekSchedule[]
    activeTab: AppTab
    searchSuggestion?: string
    onFiltersChange: (filters: FiltersState) => void
  }

  const searchClass = 'filter-search'
  const lessonTypes = Object.entries(LESSON_TYPE_LABELS).filter(
    ([type]) => type !== 'unknown',
  ) as [LessonType, string][]

  let { filters, groups, weeks, activeTab, searchSuggestion = '', onFiltersChange }: TopFiltersProps = $props()

  let showWeek = $derived(activeTab !== 'analytics')
  let showGroup = $derived(activeTab !== 'analytics' || groups.length > 0)
  let courseOptions = $derived<FilterSelectOption[]>([
    { value: 'all', label: 'Все курсы' },
    ...COURSES.map((course) => ({ value: String(course), label: `${course} курс` })),
  ])
  let visibleGroups = $derived(
    filters.course === 'all'
      ? groups
      : groups.filter((group) => {
          const withCourse = group as ScheduleGroupWithCourse
          return withCourse.course === undefined || withCourse.course === filters.course
        }),
  )
  let groupOptions = $derived<FilterSelectOption[]>([
    { value: 'all', label: 'Все группы' },
    ...visibleGroups.map((group) => {
      const withCourse = group as ScheduleGroupWithCourse
      const suffix =
        filters.course === 'all' && withCourse.course
          ? ` · ${withCourse.course} курс`
          : group.department
            ? ` · ${group.department}`
            : ''
      return { value: group.id, label: `${group.name}${suffix}` }
    }),
  ])
  let availableWeeks = $derived(
    Array.from(new Set(weeks.map((week) => week.week_number))).sort((a, b) => a - b),
  )
  let weekOptions = $derived<FilterSelectOption[]>(
    availableWeeks.map((weekNumber) => ({ value: String(weekNumber), label: `${weekNumber} неделя` })),
  )
  let selectedType = $derived(filters.lessonTypes[0] || 'all')
  let typeOptions = $derived<FilterSelectOption[]>([
    { value: 'all', label: 'Все типы' },
    ...lessonTypes.map(([type, label]) => ({ value: type, label })),
  ])
  let searchCompletion = $derived(completionFor(filters.search, searchSuggestion))
  let hasActiveFilters = $derived(
    filters.group !== 'all' || filters.subgroup !== 'all' || filters.lessonTypes.length > 0 || Boolean(filters.search),
  )

  function update(next: Partial<FiltersState>) {
    onFiltersChange({ ...filters, ...next })
  }

  function setCourse(raw: string) {
    const course: CourseSelection = raw === 'all' ? 'all' : Number(raw)
    update({ course, group: 'all', subgroup: 'all' })
  }

  function setGroup(group: string) {
    update({ group, subgroup: 'all' })
  }

  function setType(raw: string) {
    update({ lessonTypes: raw === 'all' ? [] : [raw as LessonType] })
  }

  function completionFor(query: string, suggestion: string) {
    if (!query.trim() || !suggestion) return ''
    const normalizedQuery = normalizeSearchQuery(query)
    const normalizedSuggestion = normalizeSearchQuery(suggestion)
    const compactQuery = normalizedQuery.replace(/\s+/g, '')
    const compactSuggestion = normalizedSuggestion.replace(/\s+/g, '')
    if (
      !normalizedQuery ||
      normalizedSuggestion === normalizedQuery ||
      (!normalizedSuggestion.startsWith(normalizedQuery) && !compactSuggestion.startsWith(compactQuery))
    ) {
      return ''
    }
    return suggestion.slice(query.trimEnd().length)
  }

  function acceptSearchSuggestion(event: KeyboardEvent) {
    if (!searchCompletion || !searchSuggestion) return
    if (event.key !== 'Tab' && event.key !== 'ArrowRight') return
    event.preventDefault()
    update({ search: searchSuggestion })
  }
</script>

<div class="top-filters">
  <div class="filter-field filter-field-course">
    <FilterSelect
      value={filters.course === 'all' ? 'all' : String(filters.course)}
      options={courseOptions}
      ariaLabel="Курс"
      onChange={setCourse}
    />
  </div>

  {#if showGroup}
    <div class="filter-field filter-field-group">
      <FilterSelect value={filters.group} options={groupOptions} ariaLabel="Группа" onChange={setGroup} />
    </div>
  {/if}

  <div class="filter-field filter-field-week" data-collapsed={!showWeek || availableWeeks.length === 0 ? 'true' : null}>
    <FilterSelect
      value={String(filters.week)}
      options={weekOptions}
      ariaLabel="Неделя"
      onChange={(value) => update({ week: Number(value) })}
    />
  </div>

  <div class="filter-field filter-field-type">
    <FilterSelect value={selectedType} options={typeOptions} ariaLabel="Тип занятия" onChange={setType} />
  </div>

  <label class="filter-field filter-field-search">
    <div class="filter-search-wrap">
      <Search class="filter-search-icon pointer-events-none absolute left-3 top-2 z-30 h-4 w-4 text-muted-foreground" />
      <Input
        class={searchClass}
        placeholder="Предмет, ФИО, ауд."
        value={filters.search}
        oninput={(event) => update({ search: event.currentTarget.value })}
        onkeydown={acceptSearchSuggestion}
      />
      {#if searchCompletion}
        <div class="filter-search-ghost" aria-hidden="true">
          <span class="filter-search-ghost-prefix">{filters.search}</span>{searchCompletion}
        </div>
      {/if}
    </div>
  </label>

  {#if hasActiveFilters}
    <Button
      variant="ghost"
      class="filter-reset h-9 w-9 p-0"
      onclick={() => update({ group: 'all', subgroup: 'all', lessonTypes: [], search: '' })}
      title="Сбросить фильтры"
      aria-label="Сбросить фильтры"
    >
      <X class="h-4 w-4" />
    </Button>
  {/if}
</div>
