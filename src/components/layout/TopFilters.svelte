<script lang="ts">
  import { Search, X } from '@lucide/svelte'

  import Button from '@/components/ui/Button.svelte'
  import Input from '@/components/ui/Input.svelte'
  import type { AppTab } from '@/components/layout/AppShell.svelte'
  import { COURSES, LESSON_TYPE_LABELS } from '@/lib/constants'
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
    onFiltersChange: (filters: FiltersState) => void
  }

  const selectClass = 'filter-select'
  const searchClass = 'filter-search'
  const lessonTypes = Object.entries(LESSON_TYPE_LABELS).filter(
    ([type]) => type !== 'unknown',
  ) as [LessonType, string][]

  let { filters, groups, weeks, activeTab, onFiltersChange }: TopFiltersProps = $props()

  let showWeek = $derived(activeTab !== 'analytics')
  let showGroup = $derived(activeTab !== 'analytics' || groups.length > 0)
  let visibleGroups = $derived(
    filters.course === 'all'
      ? groups
      : groups.filter((group) => {
          const withCourse = group as ScheduleGroupWithCourse
          return withCourse.course === undefined || withCourse.course === filters.course
        }),
  )
  let availableWeeks = $derived(
    Array.from(new Set(weeks.map((week) => week.week_number))).sort((a, b) => a - b),
  )
  let selectedType = $derived(filters.lessonTypes[0] || 'all')
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

  function groupKey(group: ScheduleGroup | ScheduleGroupWithCourse) {
    return `${(group as ScheduleGroupWithCourse).course ?? 'course'}-${group.id}`
  }
</script>

<div class="top-filters">
  <label class="filter-field">
    <span class="filter-label">Курс</span>
    <select class={selectClass} value={filters.course === 'all' ? 'all' : String(filters.course)} onchange={(event) => setCourse(event.currentTarget.value)} aria-label="Курс">
      <option value="all">Все курсы</option>
      {#each COURSES as course (course)}
        <option value={String(course)}>{course} курс</option>
      {/each}
    </select>
  </label>

  {#if showGroup}
    <label class="filter-field">
      <span class="filter-label">Группа</span>
      <select class={selectClass} value={filters.group} onchange={(event) => setGroup(event.currentTarget.value)} aria-label="Группа">
        <option value="all">Все группы</option>
        {#each visibleGroups as group (groupKey(group))}
          {@const withCourse = group as ScheduleGroupWithCourse}
          <option value={group.id}>
            {group.name}{#if filters.course === 'all' && withCourse.course} · {withCourse.course} курс{:else if group.department} · {group.department}{/if}
          </option>
        {/each}
      </select>
    </label>
  {/if}

  {#if showWeek && availableWeeks.length > 0}
    <label class="filter-field">
      <span class="filter-label">Неделя</span>
      <select class={selectClass} value={String(filters.week)} onchange={(event) => update({ week: Number(event.currentTarget.value) })} aria-label="Неделя">
        {#each availableWeeks as weekNumber (weekNumber)}
          <option value={String(weekNumber)}>{weekNumber} неделя</option>
        {/each}
      </select>
    </label>
  {/if}

  <label class="filter-field">
    <span class="filter-label">Тип занятия</span>
    <select class={selectClass} value={selectedType} onchange={(event) => setType(event.currentTarget.value)} aria-label="Тип занятия">
      <option value="all">Все типы</option>
      {#each lessonTypes as [type, label] (type)}
        <option value={type}>{label}</option>
      {/each}
    </select>
  </label>

  <label class="filter-field filter-field-search">
    <span class="filter-label">Поиск</span>
    <div class="relative">
      <Search class="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
      <Input
        class={searchClass}
        placeholder="Предмет, ФИО, ауд."
        value={filters.search}
        oninput={(event) => update({ search: event.currentTarget.value })}
      />
    </div>
  </label>

  {#if hasActiveFilters}
    <Button
      variant="ghost"
      class="mt-auto h-9 w-9 p-0"
      onclick={() => update({ group: 'all', subgroup: 'all', lessonTypes: [], search: '' })}
      title="Сбросить фильтры"
      aria-label="Сбросить фильтры"
    >
      <X class="h-4 w-4" />
    </Button>
  {/if}
</div>
