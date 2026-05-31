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
    LessonType,
    ScheduleGroup,
    ScheduleGroupWithCourse,
    ScheduleLesson,
  } from '@/types/schedule'

  interface AnalyticsViewProps {
    course: CourseSelection
    groupFilter: string
    groups: (ScheduleGroup | ScheduleGroupWithCourse)[]
    lessons: ScheduleLesson[]
    plans: Record<number, CoursePlanMap>
    flatPlan: CoursePlanMap
    search: string
    lessonTypes: LessonType[]
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
  let visibleRows = $derived(courseRows.filter((row) => row.groups.length > 0))
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

  function typedRowKey(courseNumber: number, subject: string, type: LessonType) {
    return `${courseNumber}:${planKey(subject, type)}`
  }

  function currentPlan(courseNumber: number) {
    return plans[courseNumber] || flatPlan
  }

  function planValue(courseNumber: number, subject: string, type: LessonType) {
    return currentPlan(courseNumber)[planKey(subject, type)]
  }

  function inputValue(courseNumber: number, subject: string, type: LessonType) {
    const key = typedRowKey(courseNumber, subject, type)
    const saved = planValue(courseNumber, subject, type)
    return planInputs[key] ?? (saved !== undefined ? String(saved) : '')
  }

  function setPlanInput(courseNumber: number, subject: string, type: LessonType, value: string) {
    planInputs = { ...planInputs, [typedRowKey(courseNumber, subject, type)]: value }
  }

  function hasPlanChange(courseNumber: number, subject: string, type: LessonType) {
    const saved = planValue(courseNumber, subject, type)
    return inputValue(courseNumber, subject, type).trim() !== (saved !== undefined ? String(saved) : '')
  }

  async function savePlan(courseNumber: number, subject: string, type: LessonType) {
    const key = typedRowKey(courseNumber, subject, type)
    const parsed = parseInt(inputValue(courseNumber, subject, type), 10)
    if (Number.isNaN(parsed) || parsed < 0) return

    savingRows = { ...savingRows, [key]: true }
    try {
      await onPlanChange({ course: courseNumber, subject, lesson_type: type, planned_pairs: parsed })
      const nextInputs = { ...planInputs }
      delete nextInputs[key]
      planInputs = nextInputs
    } catch (error) {
      alert(`Не удалось сохранить план для "${subject}" (${getLessonTypeLabel(type)}): ${(error as Error).message}`)
    } finally {
      savingRows = { ...savingRows, [key]: false }
    }
  }

  function exportCsv() {
    const header = ['Курс', 'Группа', 'Подгруппа', 'Предмет', 'Тип', 'План', 'В расписании', 'Проведено', 'Осталось']
    const rows: (string | number)[][] = []

    visibleRows.forEach((courseRow) => {
      courseRow.groups.forEach((group) => {
        group.subgroups.forEach((subgroup) => {
          subgroup.subjects.forEach((subject) => {
            rows.push([
              courseRow.course,
              group.groupName,
              subgroup.subgroup || 'вся группа',
              subject.subject,
              getLessonTypeLabel(subject.type),
              subject.cell.planned ?? '',
              subject.cell.scheduled,
              subject.cell.done,
              subject.cell.planned !== null ? Math.max(subject.cell.planned - subject.cell.done, 0) : '',
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

        {#each courseRow.groups as group (group.groupId)}
          <section class="plan-group">
            <div class="plan-group-head">
              <div>
                <div class="plan-group-name">{group.groupName}</div>
                {#if group.department}
                  <div class="plan-muted">{group.department}</div>
                {/if}
              </div>
              <div class="plan-row-metrics">
                <span>план {group.totalPlanned || '—'}</span>
                <span>расп. {group.totalScheduled}</span>
                <span>пров. {group.totalDone}</span>
              </div>
            </div>

            {#each group.subgroups as subgroup, subgroupIndex (`${group.groupId}-${subgroup.subgroup || subgroupIndex}`)}
              <div class="plan-subgroup">
                <div class="plan-subgroup-head">
                  <span>{subgroup.subgroup ? `${subgroup.subgroup} пг` : 'вся группа'}</span>
                  <span>{subgroup.totalScheduled} в расписании</span>
                </div>

                <div class="plan-table-wrap">
                  <table class="plan-table">
                    <thead>
                      <tr>
                        <th>Предмет</th>
                        <th class="w-24">Тип</th>
                        <th class="w-28">План</th>
                        <th class="w-20">Распис.</th>
                        <th class="w-20">Пров.</th>
                        <th class="w-20">Ост.</th>
                        <th class="w-28">%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {#each subgroup.subjects as subject (`${subject.subject}-${subject.type}`)}
                        {@const changed = hasPlanChange(courseRow.course, subject.subject, subject.type)}
                        {@const saveKey = typedRowKey(courseRow.course, subject.subject, subject.type)}
                        {@const percent = progressPercent(subject.cell.planned, subject.cell.done)}
                        <tr>
                          <td class="plan-subject" title={subject.subject}>{subject.subject}</td>
                          <td>
                            <span class={cn('type-badge', `type-${subject.type}`)}>
                              {LESSON_TYPE_LABELS[subject.type]}
                            </span>
                          </td>
                          <td>
                            <div class="plan-input-wrap">
                              <Input
                                class="plan-input"
                                type="number"
                                min={0}
                                value={inputValue(courseRow.course, subject.subject, subject.type)}
                                placeholder="—"
                                oninput={(event) => setPlanInput(courseRow.course, subject.subject, subject.type, event.currentTarget.value)}
                                onkeydown={(event) => {
                                  if (event.key === 'Enter' && changed) void savePlan(courseRow.course, subject.subject, subject.type)
                                }}
                              />
                              <Button
                                variant={changed ? 'primary' : 'ghost'}
                                class="h-8 w-8 p-0"
                                onclick={() => void savePlan(courseRow.course, subject.subject, subject.type)}
                                disabled={!changed || savingRows[saveKey]}
                                title="Сохранить"
                                aria-label="Сохранить"
                              >
                                <Save class="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </td>
                          <td class="plan-number">{subject.cell.scheduled}</td>
                          <td class="plan-number">{subject.cell.done}</td>
                          <td class="plan-number">{remaining(subject.cell.planned, subject.cell.done) ?? '—'}</td>
                          <td>
                            <div class="plan-progress">
                              <div class="plan-progress-track">
                                <div
                                  class={cn('plan-progress-bar', statusClass(statusColor(subject.cell)))}
                                  style={`width: ${percent === null ? 0 : Math.min(percent, 100)}%`}
                                ></div>
                              </div>
                              <span>{percent === null ? '—' : `${percent}%`}</span>
                            </div>
                          </td>
                        </tr>
                      {/each}
                    </tbody>
                  </table>
                </div>
              </div>
            {/each}
          </section>
        {/each}
      </div>
    {/each}
  {/if}
</div>
