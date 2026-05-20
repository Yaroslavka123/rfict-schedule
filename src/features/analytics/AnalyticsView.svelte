<script lang="ts">
  import { Download, Save } from '@lucide/svelte'

  import { planKey } from '@/api/scheduleClient'
  import Button from '@/components/ui/Button.svelte'
  import Card from '@/components/ui/Card.svelte'
  import Input from '@/components/ui/Input.svelte'
  import {
    buildPlanFactHierarchy,
    getCourseSubjects,
    statusColor,
    type PlanFactCourse,
  } from '@/lib/schedule'
  import { cn } from '@/lib/utils'
  import type {
    AnalyticsCell,
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
    groups: (ScheduleGroup | ScheduleGroupWithCourse)[]
    lessons: ScheduleLesson[]
    plans: Record<number, CoursePlanMap>
    flatPlan: CoursePlanMap
    search: string
    lessonTypes: LessonType[]
    onPlanChange: (entry: CoursePlanEntry) => Promise<void> | void
  }

  interface SubjectGroupRow {
    groupId: string
    groupName: string
    department?: string
    subgroups: {
      subgroup: string | null
      cell: AnalyticsCell
    }[]
    totalPlanned: number
    totalScheduled: number
    totalDone: number
  }

  interface SubjectRow {
    subject: string
    groups: SubjectGroupRow[]
    totalPlanned: number
    totalScheduled: number
    totalDone: number
  }

  interface CourseSubjectRow {
    course: number
    subjects: SubjectRow[]
    totalPlanned: number
    totalScheduled: number
    totalDone: number
  }

  let {
    course,
    groups,
    lessons,
    plans,
    flatPlan,
    search,
    lessonTypes,
    onPlanChange,
  }: AnalyticsViewProps = $props()

  const today = new Date()
  let openEditors = $state<Record<number, boolean>>({})
  let planInputs = $state<Record<string, string>>({})
  let savingRows = $state<Record<string, boolean>>({})

  let courses = $derived(
    course === 'all' ? Object.keys(plans).map(Number).sort((a, b) => a - b) : [course],
  )
  let filteredLessons = $derived(
    lessonTypes.length > 0 ? lessons.filter((lesson) => lessonTypes.includes(lesson.type)) : lessons,
  )
  let courseRows = $derived(
    buildPlanFactHierarchy({
      courses,
      groups,
      lessons: filteredLessons,
      plans,
      today,
      search,
    }),
  )
  let subjectRows = $derived(courseRows.map((row) => regroupBySubject(row, 'all', 'all')))
  let visibleRows = $derived(subjectRows.filter((row) => row.subjects.length > 0))
  let subjectsByCourse = $derived(buildSubjectsByCourse(courses, filteredLessons, groups, course))

  function buildSubjectsByCourse(
    sourceCourses: number[],
    sourceLessons: ScheduleLesson[],
    sourceGroups: (ScheduleGroup | ScheduleGroupWithCourse)[],
    selectedCourse: CourseSelection,
  ) {
    const map: Record<number, string[]> = {}
    sourceCourses.forEach((courseNumber) => {
      const courseLessons = sourceLessons.filter((lesson) => {
        if (lesson.course_number !== undefined) return lesson.course_number === courseNumber
        const group = sourceGroups.find((candidate) => candidate.id === lesson.group) as
          | ScheduleGroupWithCourse
          | undefined
        if (group?.course !== undefined) return group.course === courseNumber
        return selectedCourse !== 'all'
      })
      map[courseNumber] = getCourseSubjects(courseLessons)
    })
    return map
  }

  function exportCsv() {
    const header = [
      'Курс',
      'Предмет',
      'Группа',
      'Подгруппа',
      'План',
      'В расписании',
      'Проведено',
      'Осталось',
    ]
    const rows: (string | number)[][] = []

    visibleRows.forEach((courseRow) => {
      courseRow.subjects.forEach((subject) => {
        subject.groups.forEach((group) => {
          group.subgroups.forEach((subgroup) => {
            const remaining = subgroup.cell.planned !== null ? subgroup.cell.planned - subgroup.cell.done : ''
            rows.push([
              courseRow.course,
              subject.subject,
              group.groupName,
              subgroup.subgroup || 'целиком',
              subgroup.cell.planned ?? '',
              subgroup.cell.scheduled,
              subgroup.cell.done,
              remaining,
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

  function rowKey(courseNumber: number, subject: string) {
    return `${courseNumber}:${planKey(subject)}`
  }

  function planValue(plan: CoursePlanMap, subject: string) {
    return plan[planKey(subject)]
  }

  function inputValue(courseNumber: number, subject: string, plan: CoursePlanMap) {
    const key = rowKey(courseNumber, subject)
    return planInputs[key] ?? (planValue(plan, subject) !== undefined ? String(planValue(plan, subject)) : '')
  }

  function setPlanInput(courseNumber: number, subject: string, value: string) {
    planInputs = { ...planInputs, [rowKey(courseNumber, subject)]: value }
  }

  function hasPlanChange(courseNumber: number, subject: string, plan: CoursePlanMap) {
    return inputValue(courseNumber, subject, plan).trim() !== (planValue(plan, subject) !== undefined ? String(planValue(plan, subject)) : '')
  }

  async function savePlan(courseNumber: number, subject: string, plan: CoursePlanMap) {
    const key = rowKey(courseNumber, subject)
    const parsed = parseInt(inputValue(courseNumber, subject, plan), 10)
    if (Number.isNaN(parsed) || parsed < 0) return

    savingRows = { ...savingRows, [key]: true }
    try {
      await onPlanChange({ course: courseNumber, subject, planned_pairs: parsed })
      const nextInputs = { ...planInputs }
      delete nextInputs[key]
      planInputs = nextInputs
    } finally {
      savingRows = { ...savingRows, [key]: false }
    }
  }

  function toneClass(color: ReturnType<typeof statusColor>) {
    switch (color) {
      case 'green':
        return 'text-emerald-500'
      case 'orange':
        return 'text-amber-500'
      case 'red':
        return 'text-red-500'
      case 'blue':
        return 'text-sky-500'
      default:
        return 'text-foreground'
    }
  }

  function regroupBySubject(row: PlanFactCourse, activeGroupFilter: string, activeSubgroupFilter: string) {
    const subjectMap = new Map<string, SubjectRow>()

    row.groups
      .filter((group) => activeGroupFilter === 'all' || group.groupId === activeGroupFilter)
      .forEach((group) => {
        group.subgroups
          .filter((subgroup) => activeSubgroupFilter === 'all' || (subgroup.subgroup ?? '') === activeSubgroupFilter)
          .forEach((subgroup) => {
            subgroup.subjects.forEach((subject) => {
              let subjectEntry = subjectMap.get(subject.subject)
              if (!subjectEntry) {
                subjectEntry = {
                  subject: subject.subject,
                  groups: [],
                  totalPlanned: 0,
                  totalScheduled: 0,
                  totalDone: 0,
                }
                subjectMap.set(subject.subject, subjectEntry)
              }

              let groupEntry = subjectEntry.groups.find((candidate) => candidate.groupId === group.groupId)
              if (!groupEntry) {
                groupEntry = {
                  groupId: group.groupId,
                  groupName: group.groupName,
                  department: group.department,
                  subgroups: [],
                  totalPlanned: 0,
                  totalScheduled: 0,
                  totalDone: 0,
                }
                subjectEntry.groups.push(groupEntry)
              }

              groupEntry.subgroups.push({
                subgroup: subgroup.subgroup,
                cell: subject.cell,
              })
              groupEntry.totalPlanned += subject.cell.planned ?? 0
              groupEntry.totalScheduled += subject.cell.scheduled
              groupEntry.totalDone += subject.cell.done
              subjectEntry.totalPlanned += subject.cell.planned ?? 0
              subjectEntry.totalScheduled += subject.cell.scheduled
              subjectEntry.totalDone += subject.cell.done
            })
          })
      })

    const subjects = Array.from(subjectMap.values()).sort((a, b) => a.subject.localeCompare(b.subject, 'ru'))
    return {
      course: row.course,
      subjects,
      totalPlanned: subjects.reduce((sum, subject) => sum + subject.totalPlanned, 0),
      totalScheduled: subjects.reduce((sum, subject) => sum + subject.totalScheduled, 0),
      totalDone: subjects.reduce((sum, subject) => sum + subject.totalDone, 0),
    } satisfies CourseSubjectRow
  }
</script>

<div class="space-y-3">
  <div class="flex flex-wrap items-center gap-2">
    <h2 class="text-sm font-semibold text-muted-foreground">
      План-факт {course === 'all' ? 'по всем курсам' : `по ${course} курсу`}
    </h2>
    <span class="text-xs text-muted-foreground">на {today.toLocaleDateString('ru-RU')}</span>
    <Button variant="secondary" class="ml-auto h-9" onclick={exportCsv}>
      <Download class="h-4 w-4" />
      CSV
    </Button>
  </div>

  {#each courses as courseNumber (courseNumber)}
    {@const subjects = subjectsByCourse[courseNumber] || []}
    {@const currentPlan = plans[courseNumber] || flatPlan}
    {#if subjects.length > 0}
      {@const filledCount = subjects.filter((subject) => currentPlan[planKey(subject)] !== undefined).length}
      <div class="rounded-lg border border-border bg-card">
        <button
          type="button"
          class="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-semibold transition-all duration-200 ease-out hover:bg-muted/40"
          onclick={() => (openEditors = { ...openEditors, [courseNumber]: !openEditors[courseNumber] })}
        >
          <span>План по предметам · {courseNumber} курс ({filledCount}/{subjects.length})</span>
          <span class="text-xs text-muted-foreground">{openEditors[courseNumber] ? 'скрыть' : 'редактировать'}</span>
        </button>

        {#if openEditors[courseNumber]}
          <div class="grid grid-cols-1 gap-2 border-t border-border p-3 md:grid-cols-2 lg:grid-cols-3">
            {#each subjects as subject (subject)}
              {@const key = rowKey(courseNumber, subject)}
              {@const changed = hasPlanChange(courseNumber, subject, currentPlan)}
              <div class="flex items-center gap-2 rounded-md border border-border bg-background/50 px-2 py-1.5">
                <span class="flex-1 truncate text-sm" title={subject}>{subject}</span>
                <Input
                  class="h-8 w-16 text-center tabular-nums"
                  type="number"
                  min={0}
                  value={inputValue(courseNumber, subject, currentPlan)}
                  placeholder="—"
                  oninput={(event) => setPlanInput(courseNumber, subject, event.currentTarget.value)}
                  onkeydown={(event) => {
                    if (event.key === 'Enter' && changed) void savePlan(courseNumber, subject, currentPlan)
                  }}
                />
                <Button
                  variant="ghost"
                  class={cn('h-8 w-8 p-0', !changed && 'opacity-30')}
                  onclick={() => void savePlan(courseNumber, subject, currentPlan)}
                  disabled={!changed || savingRows[key]}
                  title="Сохранить план"
                >
                  <Save class="h-3.5 w-3.5" />
                </Button>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  {/each}

  {#if visibleRows.length === 0}
    <Card contentClass="py-12 text-center text-muted-foreground">
      {search ? 'По запросу ничего не найдено.' : 'Нет данных. Выберите курс или задайте план по предметам.'}
    </Card>
  {:else}
    {#each visibleRows as row (row.course)}
      <div class="space-y-2">
        {#if courses.length > 1}
          <div class="flex items-center justify-between gap-3 px-1 pt-1">
            <h3 class="text-sm font-bold text-primary">{row.course} курс</h3>
            <span class="flex items-center gap-3 text-xs text-muted-foreground">
              <span>план: {row.totalPlanned || '—'}</span>
              <span>в расписании: {row.totalScheduled}</span>
              <span>проведено: {row.totalDone}</span>
            </span>
          </div>
        {/if}

        <div class="space-y-2">
          {#each row.subjects as subject (subject.subject)}
            {@const aggregateProgress = subject.totalPlanned > 0 ? Math.round((subject.totalDone / subject.totalPlanned) * 100) : null}
            <div class="plan-fact-section">
              <div class="plan-fact-section-header">
                <div class="flex items-center gap-2">
                  <span class="text-sm font-bold">{subject.subject}</span>
                </div>
                <div class="flex items-center gap-4 text-xs text-muted-foreground">
                  <span>план: {subject.totalPlanned || '—'}</span>
                  <span>в расписании: {subject.totalScheduled}</span>
                  <span>проведено: {subject.totalDone}</span>
                  {#if aggregateProgress !== null}
                    <div class="flex w-24 items-center gap-2">
                      <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                        <div
                          class={cn(
                            'h-full transition-all duration-300 ease-out',
                            aggregateProgress >= 100
                              ? 'bg-emerald-500'
                              : aggregateProgress >= 50
                                ? 'bg-amber-500'
                                : 'bg-red-500',
                          )}
                          style={`width: ${Math.min(Math.max(aggregateProgress, 0), 100)}%`}
                        ></div>
                      </div>
                      <span class="text-[10px] tabular-nums">{aggregateProgress}%</span>
                    </div>
                  {/if}
                </div>
              </div>

              <div>
                {#each subject.groups as group (group.groupId)}
                  <div class="plan-fact-group-row">
                    <div class="flex min-w-0 items-center gap-2">
                      <span class="truncate font-semibold" title={group.groupName}>{group.groupName}</span>
                      {#if group.department}
                        <span class="text-[10px] text-muted-foreground">· {group.department}</span>
                      {/if}
                    </div>
                    <div class="text-right text-xs tabular-nums">план: {group.totalPlanned || '—'}</div>
                    <div class="text-right text-xs tabular-nums">расп.: {group.totalScheduled}</div>
                    <div class="text-right text-xs tabular-nums">пров.: {group.totalDone}</div>
                    <div class="text-right text-xs tabular-nums">
                      {group.totalPlanned > 0 ? `${Math.round((group.totalDone / group.totalPlanned) * 100)}%` : '—'}
                    </div>
                  </div>

                  {#each group.subgroups as subgroup, idx (`${group.groupId}-${subgroup.subgroup || idx}`)}
                    <div class="plan-fact-subgroup-row">
                      <div class="flex min-w-0 items-center gap-2">
                        <span class="truncate opacity-80">
                          {#if subgroup.subgroup}
                            {subgroup.subgroup} пг
                          {:else}
                            <span class="italic">целиком</span>
                          {/if}
                        </span>
                      </div>
                      <div class="text-right tabular-nums">
                        {#if subgroup.cell.planned !== null}
                          {subgroup.cell.planned}
                        {:else}
                          <span class="opacity-50">—</span>
                        {/if}
                      </div>
                      <div class={cn('text-right tabular-nums', toneClass(statusColor(subgroup.cell)))}>
                        {subgroup.cell.scheduled}
                      </div>
                      <div class="text-right tabular-nums">{subgroup.cell.done}</div>
                      <div class="text-right tabular-nums">
                        {#if subgroup.cell.planned !== null}
                          <span>{Math.max(subgroup.cell.planned - subgroup.cell.done, 0)}</span>
                        {:else}
                          <span class="opacity-50">—</span>
                        {/if}
                      </div>
                    </div>
                  {/each}
                {/each}
              </div>
            </div>
          {/each}
        </div>
      </div>
    {/each}
  {/if}
</div>
