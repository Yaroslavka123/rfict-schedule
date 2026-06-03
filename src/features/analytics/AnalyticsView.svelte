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

  function subjectKey(courseNumber: number, subject: string) {
    return `${courseNumber}:${planKey(subject)}`
  }

  function groupKey(courseNumber: number, subject: string, groupId: string) {
    return `${courseNumber}:${planKey(subject, null, groupId)}`
  }

  function currentPlan(courseNumber: number) {
    return plans[courseNumber] || flatPlan
  }

  function subjectPlanValue(courseNumber: number, subject: string) {
    return currentPlan(courseNumber)[planKey(subject)]
  }

  function groupPlanValue(courseNumber: number, subject: string, groupId: string) {
    return currentPlan(courseNumber)[planKey(subject, null, groupId)]
  }

  function inputValue(key: string, saved: number | undefined, resolved: number | undefined) {
    return planInputs[key] ?? (saved !== undefined ? String(saved) : resolved !== undefined ? String(resolved) : '')
  }

  function setInput(key: string, value: string) {
    planInputs = { ...planInputs, [key]: value }
  }

  function hasChange(key: string, resolved: number | undefined) {
    const baseline = resolved !== undefined ? String(resolved) : ''
    return (planInputs[key] ?? '').trim() !== baseline
  }

  async function saveSubjectPlan(courseNumber: number, subject: string) {
    const key = subjectKey(courseNumber, subject)
    const parsed = parseInt(planInputs[key] ?? '', 10)
    if (Number.isNaN(parsed) || parsed < 0) return

    savingRows = { ...savingRows, [key]: true }
    try {
      await onPlanChange({ course: courseNumber, subject, planned_pairs: parsed })
      const nextInputs = { ...planInputs }
      delete nextInputs[key]
      planInputs = nextInputs
    } catch (error) {
      alert(`Не удалось сохранить план для "${subject}": ${(error as Error).message}`)
    } finally {
      savingRows = { ...savingRows, [key]: false }
    }
  }

  async function saveGroupPlan(courseNumber: number, subject: string, groupId: string) {
    const key = groupKey(courseNumber, subject, groupId)
    const parsed = parseInt(planInputs[key] ?? '', 10)
    if (Number.isNaN(parsed) || parsed < 0) return

    savingRows = { ...savingRows, [key]: true }
    try {
      await onPlanChange({
        course: courseNumber,
        subject,
        planned_pairs: parsed,
        group: groupId,
      })
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
    const header = ['Курс', 'Предмет', 'Типы', 'Группа', 'Подгруппа', 'План', 'В расписании', 'Проведено', 'Осталось', '%']
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
              progressPercent(subgroup.cell.planned, subgroup.cell.done) ?? '',
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

  function statusTone(cell: { planned: number | null; scheduled: number; done: number }) {
    const color = statusColor(cell)
    switch (color) {
      case 'green':
        return 'plan-cell-good'
      case 'orange':
        return 'plan-cell-over'
      case 'red':
        return 'plan-cell-under'
      case 'blue':
        return 'plan-cell-progress'
      default:
        return 'plan-cell-neutral'
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
      <section class="plan-course">
        {#if course === 'all'}
          <div class="plan-course-title">{courseRow.course} курс</div>
        {/if}

        <div class="plan-table-wrap">
          <table class="plan-table">
            <thead>
              <tr>
                <th class="plan-col-subject">Предмет</th>
                <th class="plan-col-group">Группа / подгруппа</th>
                <th class="plan-col-plan">План</th>
                <th class="plan-col-num">Расп.</th>
                <th class="plan-col-num">Пров.</th>
                <th class="plan-col-num">Ост.</th>
                <th class="plan-col-progress">Прогресс</th>
              </tr>
            </thead>
            <tbody>
              {#each courseRow.subjects as subject (`${courseRow.course}-${subject.subject}`)}
                {@const subjectSaved = subjectPlanValue(courseRow.course, subject.subject)}
                {@const subjectKeyId = subjectKey(courseRow.course, subject.subject)}
                {@const subjectChanged = hasChange(subjectKeyId, subjectSaved)}
                {@const subjectPercent = progressPercent(subject.totalPlanned || null, subject.totalDone)}
                <tr class="plan-row plan-row-subject">
                  <td class="plan-col-subject">
                    <div class="plan-subject-name" title={subject.subject}>{subject.subject}</div>
                    <div class="plan-subject-types">
                      {#each subject.types as type, i (type)}
                        {#if i > 0}<span class="plan-subject-types-sep">·</span>{/if}
                        <span class="plan-subject-type-chip">{getLessonTypeLabel(type)}</span>
                      {/each}
                    </div>
                  </td>
                  <td class="plan-col-group plan-col-group-empty">—</td>
                  <td class="plan-col-plan">
                    <div class="plan-input-group">
                      <Input
                        class="plan-input"
                        type="number"
                        min={0}
                        value={inputValue(subjectKeyId, subjectSaved, subjectSaved)}
                        placeholder="—"
                        oninput={(event) => setInput(subjectKeyId, event.currentTarget.value)}
                        onkeydown={(event) => {
                          if (event.key === 'Enter' && subjectChanged) {
                            void saveSubjectPlan(courseRow.course, subject.subject)
                          }
                        }}
                      />
                      <Button
                        variant={subjectChanged ? 'primary' : 'ghost'}
                        class="plan-input-save"
                        onclick={() => void saveSubjectPlan(courseRow.course, subject.subject)}
                        disabled={!subjectChanged || savingRows[subjectKeyId]}
                        title="Сохранить план предмета (по умолчанию для всех групп)"
                        aria-label="Сохранить план предмета"
                      >
                        <Save class="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </td>
                  <td class={cn('plan-col-num plan-num', statusTone({ planned: subject.totalPlanned || null, scheduled: subject.totalScheduled, done: subject.totalDone }))}>
                    {subject.totalScheduled}
                  </td>
                  <td class="plan-col-num plan-num plan-num-done">{subject.totalDone}</td>
                  <td class="plan-col-num plan-num plan-num-remain">
                    {remaining(subject.totalPlanned || null, subject.totalDone) ?? '—'}
                  </td>
                  <td class="plan-col-progress">
                    <div class="plan-progress">
                      <div class="plan-progress-track">
                        <div
                          class={cn('plan-progress-bar', statusClass(statusColor({ planned: subject.totalPlanned || null, scheduled: subject.totalScheduled, done: subject.totalDone })))}
                          style={`width: ${subjectPercent === null ? 0 : Math.min(subjectPercent, 100)}%`}
                        ></div>
                      </div>
                      <span class="plan-progress-label">
                        {subjectPercent === null ? '—' : `${subjectPercent}%`}
                      </span>
                    </div>
                  </td>
                </tr>

                {#each subject.groups as group (`${courseRow.course}-${subject.subject}-${group.groupId}`)}
                  {@const groupSaved = groupPlanValue(courseRow.course, subject.subject, group.groupId)}
                  {@const groupKeyId = groupKey(courseRow.course, subject.subject, group.groupId)}
                  {@const groupChanged = hasChange(groupKeyId, groupSaved)}
                  {@const groupPercent = progressPercent(group.totalPlanned || null, group.totalDone)}
                  {@const firstSubgroup = group.subgroups[0]}
                  <tr class="plan-row plan-row-group">
                    <td class="plan-col-subject">
                      {#if group.department}
                        <div class="plan-group-dept">{group.department}</div>
                      {/if}
                    </td>
                    <td class="plan-col-group">
                      <div class="plan-group-name">{group.groupName}</div>
                    </td>
                    <td class="plan-col-plan">
                      <div class="plan-input-group">
                        <Input
                          class="plan-input"
                          type="number"
                          min={0}
                          value={inputValue(groupKeyId, groupSaved, groupSaved)}
                          placeholder="—"
                          oninput={(event) => setInput(groupKeyId, event.currentTarget.value)}
                          onkeydown={(event) => {
                            if (event.key === 'Enter' && groupChanged) {
                              void saveGroupPlan(courseRow.course, subject.subject, group.groupId)
                            }
                          }}
                        />
                        <Button
                          variant={groupChanged ? 'primary' : 'ghost'}
                          class="plan-input-save"
                          onclick={() => void saveGroupPlan(courseRow.course, subject.subject, group.groupId)}
                          disabled={!groupChanged || savingRows[groupKeyId]}
                          title="Сохранить план для группы (переопределяет план предмета)"
                          aria-label="Сохранить план группы"
                        >
                          <Save class="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                    <td class={cn('plan-col-num plan-num', statusTone({ planned: group.totalPlanned || null, scheduled: group.totalScheduled, done: group.totalDone }))}>
                      {group.totalScheduled}
                    </td>
                    <td class="plan-col-num plan-num plan-num-done">{group.totalDone}</td>
                    <td class="plan-col-num plan-num plan-num-remain">
                      {remaining(group.totalPlanned || null, group.totalDone) ?? '—'}
                    </td>
                    <td class="plan-col-progress">
                      <div class="plan-progress">
                        <div class="plan-progress-track">
                          <div
                            class={cn('plan-progress-bar', statusClass(statusColor({ planned: group.totalPlanned || null, scheduled: group.totalScheduled, done: group.totalDone })))}
                            style={`width: ${groupPercent === null ? 0 : Math.min(groupPercent, 100)}%`}
                          ></div>
                        </div>
                        <span class="plan-progress-label">
                          {groupPercent === null ? '—' : `${groupPercent}%`}
                        </span>
                      </div>
                    </td>
                  </tr>

                  {#each group.subgroups as subgroup, subgroupIndex (subgroup.subgroup || 'all')}
                    {@const sgPercent = progressPercent(subgroup.cell.planned, subgroup.cell.done)}
                    <tr class="plan-row plan-row-subgroup" class:plan-row-subgroup-first={subgroupIndex === 0}>
                      <td class="plan-col-subject"></td>
                      <td class="plan-col-group">
                        <div class="plan-subgroup-cell">
                          <span class="plan-subgroup-label">
                            {subgroup.subgroup ? `${subgroup.subgroup} пг` : 'вся группа'}
                          </span>
                          {#if parityLabel(subgroup.parity)}
                            <span class="plan-subgroup-parity">{parityLabel(subgroup.parity)}</span>
                          {/if}
                          {#if !subgroup.subgroup}
                            <span class="plan-subgroup-resolved">
                              {#if subgroup.cell.planned === firstSubgroup?.cell.planned && groupSaved === undefined}
                                (план предмета)
                              {:else if subgroup.cell.planned === (groupSaved ?? subjectSaved ?? undefined) && (groupSaved !== undefined || subjectSaved !== undefined)}
                                (план {groupSaved !== undefined ? 'группы' : 'предмета'})
                              {:else if subgroup.cell.planned !== undefined}
                                (план подгруппы)
                              {/if}
                            </span>
                          {/if}
                        </div>
                      </td>
                      <td class="plan-col-plan plan-col-plan-readonly">
                        {subgroup.cell.planned ?? '—'}
                      </td>
                      <td class={cn('plan-col-num plan-num', statusTone(subgroup.cell))}>
                        {subgroup.cell.scheduled}
                      </td>
                      <td class="plan-col-num plan-num plan-num-done">{subgroup.cell.done}</td>
                      <td class="plan-col-num plan-num plan-num-remain">
                        {remaining(subgroup.cell.planned, subgroup.cell.done) ?? '—'}
                      </td>
                      <td class="plan-col-progress">
                        <div class="plan-progress">
                          <div class="plan-progress-track">
                            <div
                              class={cn('plan-progress-bar', statusClass(statusColor(subgroup.cell)))}
                              style={`width: ${sgPercent === null ? 0 : Math.min(sgPercent, 100)}%`}
                            ></div>
                          </div>
                          <span class="plan-progress-label">
                            {sgPercent === null ? '—' : `${sgPercent}%`}
                          </span>
                        </div>
                      </td>
                    </tr>
                  {/each}
                {/each}
              {/each}
            </tbody>
          </table>
        </div>
      </section>
    {/each}
  {/if}
</div>
