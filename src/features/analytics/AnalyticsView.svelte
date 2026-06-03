<script lang="ts">
  import { Download, Save } from '@lucide/svelte'

  import { planKey } from '@/api/scheduleClient'
  import Button from '@/components/ui/Button.svelte'
  import Card from '@/components/ui/Card.svelte'
  import Input from '@/components/ui/Input.svelte'
  import { COURSES, LESSON_TYPE_LABELS } from '@/lib/constants'
  import { buildPlanFactHierarchy, getLessonTypeLabel, statusColor, type PlanFactCourse } from '@/lib/schedule'
  import { cn } from '@/lib/utils'
  import type {
    CoursePlanEntry,
    CoursePlanMap,
    CourseSelection,
    ScheduleGroup,
    ScheduleGroupWithCourse,
    ScheduleLesson,
    SubgroupParity,
  } from '@/types/schedule'

  interface AnalyticsViewProps {
    course: CourseSelection
    groupFilter: string
    groups: (ScheduleGroup | ScheduleGroupWithCourse)[]
    lessons: ScheduleLesson[]
    plans: Record<number, CoursePlanMap>
    flatPlan: CoursePlanMap
    search: string
    lessonTypes: ScheduleLesson['type'][]
    onPlanChange: (entry: CoursePlanEntry) => Promise<void> | void
  }

  let {
    course,
    groupFilter,
    groups,
    lessons,
    plans,
    flatPlan,
    search,
    lessonTypes,
    onPlanChange,
  }: AnalyticsViewProps = $props()

  let today = $state(new Date())
  let planInputs = $state<Record<string, string>>({})
  let savingRows = $state<Record<string, boolean>>({})

  $effect(() => {
    const interval = setInterval(() => {
      today = new Date()
    }, 60_000)
    return () => clearInterval(interval)
  })

  let courses = $derived(resolveCourses(course, groups, lessons))
  let filteredLessons = $derived(
    lessons.filter((lesson) => {
      if (groupFilter !== 'all' && lesson.group !== groupFilter) return false
      return lessonTypes.length === 0 || lessonTypes.includes(lesson.type)
    }),
  )
  let filteredGroups = $derived(groupFilter === 'all' ? groups : groups.filter((group) => group.id === groupFilter))
  let courseRows = $derived(
    buildPlanFactHierarchy({
      courses,
      groups: filteredGroups,
      lessons: filteredLessons,
      plans,
      today,
      search,
    }),
  )
  let visibleRows = $derived(courseRows.filter((row) => row.subjects.length > 0))
  let summary = $derived(summarize(visibleRows))
  let completion = $derived(summary.planned > 0 ? Math.round((summary.done / summary.planned) * 100) : null)

  function resolveCourses(
    selectedCourse: CourseSelection,
    sourceGroups: (ScheduleGroup | ScheduleGroupWithCourse)[],
    sourceLessons: ScheduleLesson[],
  ) {
    if (selectedCourse !== 'all') return [selectedCourse]
    const found = new Set<number>()
    sourceGroups.forEach((group) => {
      const courseNumber = (group as ScheduleGroupWithCourse).course
      if (courseNumber !== undefined) found.add(courseNumber)
    })
    sourceLessons.forEach((lesson) => {
      if (lesson.course_number !== undefined) found.add(lesson.course_number)
    })
    return (found.size > 0 ? Array.from(found) : [...COURSES]).sort((a, b) => a - b)
  }

  function summarize(rows: PlanFactCourse[]) {
    return rows.reduce(
      (acc, row) => ({
        planned: acc.planned + row.totalPlanned,
        scheduled: acc.scheduled + row.totalScheduled,
        done: acc.done + row.totalDone,
      }),
      { planned: 0, scheduled: 0, done: 0 },
    )
  }

  function scopedRowKey(courseNumber: number, subject: string, groupId?: string, subgroup?: string | null) {
    return `${courseNumber}:${planKey(subject, null, groupId, subgroup)}`
  }

  function currentPlan(courseNumber: number) {
    return plans[courseNumber] || flatPlan
  }

  function ownPlanValue(courseNumber: number, subject: string, groupId?: string, subgroup?: string | null) {
    return currentPlan(courseNumber)[planKey(subject, null, groupId, subgroup)]
  }

  function resolvedPlanValue(courseNumber: number, subject: string, groupId?: string, subgroup?: string | null) {
    if (groupId && subgroup) {
      const subgroupPlan = ownPlanValue(courseNumber, subject, groupId, subgroup)
      if (subgroupPlan !== undefined) return subgroupPlan
    }
    if (groupId) {
      const groupPlan = ownPlanValue(courseNumber, subject, groupId)
      if (groupPlan !== undefined) return groupPlan
    }
    return ownPlanValue(courseNumber, subject)
  }

  function inputValue(courseNumber: number, subject: string, groupId?: string, subgroup?: string | null) {
    const key = scopedRowKey(courseNumber, subject, groupId, subgroup)
    const saved = ownPlanValue(courseNumber, subject, groupId, subgroup)
    const resolved = resolvedPlanValue(courseNumber, subject, groupId, subgroup)
    return planInputs[key] ?? (saved !== undefined ? String(saved) : resolved !== undefined ? String(resolved) : '')
  }

  function setPlanInput(courseNumber: number, subject: string, value: string, groupId?: string, subgroup?: string | null) {
    planInputs = { ...planInputs, [scopedRowKey(courseNumber, subject, groupId, subgroup)]: value }
  }

  function hasPlanChange(courseNumber: number, subject: string, groupId?: string, subgroup?: string | null) {
    const resolved = resolvedPlanValue(courseNumber, subject, groupId, subgroup)
    const baseline = resolved !== undefined ? String(resolved) : ''
    return inputValue(courseNumber, subject, groupId, subgroup).trim() !== baseline
  }

  async function savePlan(courseNumber: number, subject: string, groupId?: string, subgroup?: string | null) {
    const key = scopedRowKey(courseNumber, subject, groupId, subgroup)
    const parsed = parseInt(inputValue(courseNumber, subject, groupId, subgroup), 10)
    if (Number.isNaN(parsed) || parsed < 0) return

    const entry: CoursePlanEntry = { course: courseNumber, subject, planned_pairs: parsed }
    if (groupId) entry.group = groupId
    if (subgroup) entry.subgroup = subgroup

    savingRows = { ...savingRows, [key]: true }
    try {
      await onPlanChange(entry)
      const nextInputs = { ...planInputs }
      delete nextInputs[key]
      planInputs = nextInputs
    } catch (error) {
      alert(`Не удалось сохранить план для "${subject}": ${(error as Error).message}`)
    } finally {
      savingRows = { ...savingRows, [key]: false }
    }
  }

  function exportCsv() {
    const header = ['Курс', 'Предмет', 'Типы', 'Группа', 'Подгруппа', 'План', 'В расписании', 'Проведено', 'Осталось']
    const rows: (string | number)[][] = []

    visibleRows.forEach((courseRow) => {
      courseRow.subjects.forEach((subject) => {
        subject.groups.forEach((group) => {
          group.subgroups.forEach((subgroup) => {
            rows.push([
              courseRow.course,
              subject.subject,
              typeLabels(subject.types),
              group.groupName,
              subgroupLabel(subgroup.subgroup),
              subgroup.cell.planned ?? '',
              subgroup.cell.scheduled,
              subgroup.cell.done,
              remaining(subgroup.cell.planned, subgroup.cell.done) ?? '',
            ])
          })
        })
      })
    })

    const csv = [header, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(';'))
      .join('\n')
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `plan-fact-${course === 'all' ? 'all' : course}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  function remaining(planned: number | null, done: number) {
    return planned === null ? null : Math.max(planned - done, 0)
  }

  function progressPercent(planned: number | null, done: number) {
    if (planned === null || planned <= 0) return null
    return Math.min(Math.round((done / planned) * 100), 999)
  }

  function statusClass(color: ReturnType<typeof statusColor>) {
    switch (color) {
      case 'green':
        return 'bg-emerald-500'
      case 'orange':
        return 'bg-amber-500'
      case 'red':
        return 'bg-red-500'
      case 'blue':
        return 'bg-sky-500'
      default:
        return 'bg-muted-foreground/35'
    }
  }

  function typeLabels(types: ScheduleLesson['type'][]) {
    return types.map((type) => LESSON_TYPE_LABELS[type] || getLessonTypeLabel(type)).join(', ')
  }

  function subgroupLabel(subgroup: string | null) {
    return subgroup ? `${subgroup} пг` : 'вся группа'
  }

  function parityLabel(parity: SubgroupParity) {
    if (parity === 'even') return 'чет'
    if (parity === 'odd') return 'нечет'
    if (parity === 'mixed') return 'чет/нечет'
    return ''
  }
</script>

<div class="analytics-page">
  <div class="analytics-summary">
    <div class="summary-metric">
      <span>{summary.planned || '—'}</span>
      <small>план</small>
    </div>
    <div class="summary-metric">
      <span>{summary.scheduled}</span>
      <small>расп.</small>
    </div>
    <div class="summary-metric">
      <span>{summary.done}</span>
      <small>пров.</small>
    </div>
    <div class="summary-metric">
      <span>{completion !== null ? `${completion}%` : '—'}</span>
      <small>итог</small>
    </div>
    <Button variant="secondary" class="ml-auto h-8 px-3 text-xs" onclick={exportCsv}>
      <Download class="h-3.5 w-3.5" />
      CSV
    </Button>
  </div>

  {#if visibleRows.length === 0}
    <Card contentClass="py-12 text-center">
      <div class="text-sm font-semibold">{search ? 'Ничего не найдено' : 'Нет данных'}</div>
      <div class="mt-1 text-sm text-muted-foreground">Измените курс, группу, тип занятия или поиск.</div>
    </Card>
  {:else}
    {#each visibleRows as courseRow (courseRow.course)}
      <div class="plan-course">
        {#if course === 'all'}
          <div class="plan-course-title">{courseRow.course} курс</div>
        {/if}

        {#each courseRow.subjects as subject (`${courseRow.course}-${subject.subject}`)}
          {@const subjectChanged = hasPlanChange(courseRow.course, subject.subject)}
          {@const subjectSaveKey = scopedRowKey(courseRow.course, subject.subject)}
          {@const subjectPercent = progressPercent(subject.totalPlanned || null, subject.totalDone)}
          <section class="plan-subject-card">
            <div class="plan-subject-head">
              <div class="plan-subject-main">
                <div class="plan-subject-title" title={subject.subject}>{subject.subject}</div>
                <div class="plan-subject-meta">{typeLabels(subject.types)}</div>
              </div>

              <div class="plan-subject-actions">
                <div class="plan-scope-control" title="План предмета по умолчанию для курса">
                  <span>курс</span>
                  <Input
                    class="plan-input"
                    type="number"
                    min={0}
                    value={inputValue(courseRow.course, subject.subject)}
                    placeholder="—"
                    oninput={(event) => setPlanInput(courseRow.course, subject.subject, event.currentTarget.value)}
                    onkeydown={(event) => {
                      if (event.key === 'Enter' && subjectChanged) void savePlan(courseRow.course, subject.subject)
                    }}
                  />
                  <Button
                    variant={subjectChanged ? 'primary' : 'ghost'}
                    class="h-8 w-8 p-0"
                    onclick={() => void savePlan(courseRow.course, subject.subject)}
                    disabled={!subjectChanged || savingRows[subjectSaveKey]}
                    title="Сохранить план курса"
                    aria-label="Сохранить план курса"
                  >
                    <Save class="h-3.5 w-3.5" />
                  </Button>
                </div>

                <div class="plan-fact-metrics">
                  <span>план {subject.totalPlanned || '—'}</span>
                  <span>расп. {subject.totalScheduled}</span>
                  <span>пров. {subject.totalDone}</span>
                  <span>{subjectPercent === null ? '—' : `${subjectPercent}%`}</span>
                </div>
              </div>
            </div>

            <div class="plan-fact-groups">
              {#each subject.groups as group (`${courseRow.course}-${subject.subject}-${group.groupId}`)}
                {@const groupChanged = hasPlanChange(courseRow.course, subject.subject, group.groupId)}
                {@const groupSaveKey = scopedRowKey(courseRow.course, subject.subject, group.groupId)}
                <div class="plan-fact-group-row">
                  <div class="plan-fact-group-head">
                    <div>
                      <div class="plan-group-name">{group.groupName}</div>
                      {#if group.department}
                        <div class="plan-muted">{group.department}</div>
                      {/if}
                    </div>

                    <div class="plan-scope-control" title="Переопределить план для группы">
                      <span>группа</span>
                      <Input
                        class="plan-input"
                        type="number"
                        min={0}
                        value={inputValue(courseRow.course, subject.subject, group.groupId)}
                        placeholder="—"
                        oninput={(event) => setPlanInput(courseRow.course, subject.subject, event.currentTarget.value, group.groupId)}
                        onkeydown={(event) => {
                          if (event.key === 'Enter' && groupChanged) void savePlan(courseRow.course, subject.subject, group.groupId)
                        }}
                      />
                      <Button
                        variant={groupChanged ? 'primary' : 'ghost'}
                        class="h-8 w-8 p-0"
                        onclick={() => void savePlan(courseRow.course, subject.subject, group.groupId)}
                        disabled={!groupChanged || savingRows[groupSaveKey]}
                        title="Сохранить план группы"
                        aria-label="Сохранить план группы"
                      >
                        <Save class="h-3.5 w-3.5" />
                      </Button>
                    </div>

                    <div class="plan-row-metrics">
                      <span>план {group.totalPlanned || '—'}</span>
                      <span>расп. {group.totalScheduled}</span>
                      <span>пров. {group.totalDone}</span>
                    </div>
                  </div>

                  <div class="plan-fact-subgroups">
                    {#each group.subgroups as subgroup (`${group.groupId}-${subgroup.subgroup || 'all'}`)}
                      {@const subgroupChanged = subgroup.subgroup ? hasPlanChange(courseRow.course, subject.subject, group.groupId, subgroup.subgroup) : false}
                      {@const subgroupSaveKey = subgroup.subgroup ? scopedRowKey(courseRow.course, subject.subject, group.groupId, subgroup.subgroup) : ''}
                      {@const percent = progressPercent(subgroup.cell.planned, subgroup.cell.done)}
                      <div class="plan-fact-subgroup-row">
                        <div class="plan-fact-label">
                          <span>{subgroupLabel(subgroup.subgroup)}</span>
                          {#if parityLabel(subgroup.parity)}
                            <small>{parityLabel(subgroup.parity)}</small>
                          {/if}
                        </div>

                        {#if subgroup.subgroup}
                          <div class="plan-scope-control" title="Переопределить план для подгруппы">
                            <span>пг</span>
                            <Input
                              class="plan-input"
                              type="number"
                              min={0}
                              value={inputValue(courseRow.course, subject.subject, group.groupId, subgroup.subgroup)}
                              placeholder="—"
                              oninput={(event) => setPlanInput(courseRow.course, subject.subject, event.currentTarget.value, group.groupId, subgroup.subgroup)}
                              onkeydown={(event) => {
                                if (event.key === 'Enter' && subgroupChanged) {
                                  void savePlan(courseRow.course, subject.subject, group.groupId, subgroup.subgroup)
                                }
                              }}
                            />
                            <Button
                              variant={subgroupChanged ? 'primary' : 'ghost'}
                              class="h-8 w-8 p-0"
                              onclick={() => void savePlan(courseRow.course, subject.subject, group.groupId, subgroup.subgroup)}
                              disabled={!subgroupChanged || savingRows[subgroupSaveKey]}
                              title="Сохранить план подгруппы"
                              aria-label="Сохранить план подгруппы"
                            >
                              <Save class="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        {:else}
                          <div class="plan-row-value">план {subgroup.cell.planned ?? '—'}</div>
                        {/if}

                        <div class="plan-number">расп. {subgroup.cell.scheduled}</div>
                        <div class="plan-number">пров. {subgroup.cell.done}</div>
                        <div class="plan-number">ост. {remaining(subgroup.cell.planned, subgroup.cell.done) ?? '—'}</div>
                        <div class="plan-progress">
                          <div class="plan-progress-track">
                            <div
                              class={cn('plan-progress-bar', statusClass(statusColor(subgroup.cell)))}
                              style={`width: ${percent === null ? 0 : Math.min(percent, 100)}%`}
                            ></div>
                          </div>
                          <span>{percent === null ? '—' : `${percent}%`}</span>
                        </div>
                      </div>
                    {/each}
                  </div>
                </div>
              {/each}
            </div>
          </section>
        {/each}
      </div>
    {/each}
  {/if}
</div>
