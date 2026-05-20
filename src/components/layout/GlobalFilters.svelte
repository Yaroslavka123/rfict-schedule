<script lang="ts">
  import { Search, X } from '@lucide/svelte'

  import type { AppTab } from '@/components/layout/AppShell.svelte'
  import Button from '@/components/ui/Button.svelte'
  import Card from '@/components/ui/Card.svelte'
  import Input from '@/components/ui/Input.svelte'
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

  const filterableTypes = Object.entries(LESSON_TYPE_LABELS).filter(
    ([type]) => type !== 'unknown',
  ) as [LessonType, string][]

  const selectClass =
    'h-9 w-full rounded-xl border border-border bg-card px-3 text-sm font-medium text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20'

  let { filters, groups, weeks, lessons, activeTab, onFiltersChange }: GlobalFiltersProps = $props()

  let showWeek = $derived(activeTab === 'schedule' || activeTab === 'rooms')
  let showSubgroup = $derived(filters.group !== 'all' && activeTab !== 'rooms')
  let showTypes = $derived(activeTab === 'schedule' || activeTab === 'teachers' || activeTab === 'rooms')
  let showSearch = $derived(activeTab !== 'rooms')
  let subgroupOptions = $derived(filters.group === 'all' ? [] : getSubgroupsForGroup(lessons, filters.group))
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
  let hasActiveFilters = $derived(
    filters.group !== 'all' || filters.subgroup !== 'all' || filters.lessonTypes.length > 0 || Boolean(filters.search),
  )

  function setFilter<K extends keyof FiltersState>(key: K, value: FiltersState[K]) {
    if (key === 'group') {
      onFiltersChange({ ...filters, group: value as string, subgroup: 'all' })
      return
    }
    onFiltersChange({ ...filters, [key]: value })
  }

  function toggleType(type: LessonType) {
    const enabled = filters.lessonTypes.includes(type)
    setFilter(
      'lessonTypes',
      enabled ? filters.lessonTypes.filter((current) => current !== type) : [...filters.lessonTypes, type],
    )
  }
</script>

<Card contentClass="space-y-3 p-3">
  {#if showSearch}
    <div class="space-y-1">
      <p class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Поиск</p>
      <div class="relative">
        <Search class="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          class="h-9 pl-9 text-sm"
          placeholder="Предмет, преподаватель..."
          value={filters.search}
          oninput={(event) => setFilter('search', event.currentTarget.value)}
        />
      </div>
    </div>
  {/if}

  <div class="space-y-1">
    <p class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Курс</p>
    <select
      class={selectClass}
      value={filters.course === 'all' ? 'all' : String(filters.course)}
      onchange={(event) => {
        const raw = event.currentTarget.value
        const next: CourseSelection = raw === 'all' ? 'all' : Number(raw)
        onFiltersChange({ ...filters, course: next, group: 'all', subgroup: 'all' })
      }}
    >
      <option value="all">Все курсы</option>
      {#each COURSES as course (course)}
        <option value={course}>{course} курс</option>
      {/each}
    </select>
  </div>

  <div class="space-y-1">
    <p class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Группа</p>
    <select class={selectClass} value={filters.group} onchange={(event) => setFilter('group', event.currentTarget.value)}>
      <option value="all">Все группы</option>
      {#each visibleGroups as group (group.id)}
        {@const withCourse = group as ScheduleGroupWithCourse}
        <option value={group.id}>
          {group.name}{#if filters.course === 'all' && withCourse.course} · {withCourse.course} курс{:else if group.department} · {group.department}{/if}
        </option>
      {/each}
    </select>
  </div>

  {#if showSubgroup && subgroupOptions.length > 0}
    <div class="space-y-1">
      <p class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Подгруппа</p>
      <select
        class={selectClass}
        value={filters.subgroup}
        onchange={(event) => setFilter('subgroup', event.currentTarget.value)}
      >
        <option value="all">Все</option>
        {#each subgroupOptions as subgroup (subgroup)}
          <option value={subgroup}>{subgroup}</option>
        {/each}
      </select>
    </div>
  {/if}

  {#if showWeek && availableWeeks.length > 0}
    <div class="space-y-1">
      <p class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Неделя</p>
      <div class="flex flex-wrap gap-1">
        {#each availableWeeks as weekNumber (weekNumber)}
          <button
            type="button"
            class={weekNumber === filters.week
              ? 'rounded-md border border-primary bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary'
              : 'rounded-md border border-border bg-background px-2 py-0.5 text-xs font-semibold text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground'}
            onclick={() => setFilter('week', weekNumber)}
          >
            {weekNumber}
          </button>
        {/each}
      </div>
    </div>
  {/if}

  {#if showTypes}
    <div class="space-y-1">
      <p class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Тип</p>
      <div class="flex flex-wrap gap-1">
        {#each filterableTypes as [type, label] (type)}
          <button
            type="button"
            class={filters.lessonTypes.includes(type) ? 'filter-chip filter-chip-active' : 'filter-chip'}
            onclick={() => toggleType(type)}
          >
            {label}
          </button>
        {/each}
      </div>
    </div>
  {/if}

  {#if hasActiveFilters}
    <Button
      variant="ghost"
      class="h-8 w-full text-xs"
      onclick={() => onFiltersChange({ ...filters, group: 'all', subgroup: 'all', lessonTypes: [], search: '' })}
    >
      <X class="h-3.5 w-3.5" />
      Сбросить фильтры
    </Button>
  {/if}
</Card>
