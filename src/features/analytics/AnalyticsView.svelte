<script lang="ts">
  import { Check, ChevronDown, ChevronRight, Download, Loader2, Save, X } from '@lucide/svelte'

  import { planKey } from '@/api/scheduleClient'
  import Button from '@/components/ui/Button.svelte'
  import Card from '@/components/ui/Card.svelte'
  import Input from '@/components/ui/Input.svelte'
  import { COURSES } from '@/lib/constants'
  import {
    buildPlanFactHierarchy,
    getLessonTypeLabel,
    statusColor,
    type PlanFactCourse,
    type PlanFactTypeRowExport,
  } from '@/lib/schedule'
  import { cn } from '@/lib/utils'
  import type {
    CoursePlanEntry,
    CoursePlanMap,
    CourseSelection,
    LessonType,
    ScheduleGroup,
    ScheduleGroupWithCourse,
    ScheduleLesson,
    SubgroupParity,
  } from '@/types/schedule'

  interface AnalyticsViewProps {
    active: boolean
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
    active,
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
  let saveStatus = $state<Record<string, 'saved' | 'error'>>({})
  const savedTimers = new Map<string, ReturnType<typeof setTimeout>>()
  let expandedSubjects = $state<Set<string>>(new Set())
  let expandedGroups = $state<Set<string>>(new Set())

  $effect(() => {
    if (!active) return
    const interval = setInterval(() => {
      const next = new Date()
      if (dayKey(next) !== dayKey(today)) today = next
    }, 60_000)
    return () => clearInterval(interval)
  })

  let courses = $derived(active ? resolveCourses(course, groups, lessons) : [])
  let filteredLessons = $derived(
    active
      ? lessons.filter((lesson) => {
          if (groupFilter !== 'all' && lesson.group !== groupFilter) return false
          return lessonTypes.length === 0 || lessonTypes.includes(lesson.type)
        })
      : [],
  )
  let filteredGroups = $derived(
    active
      ? groupFilter === 'all'
        ? groups
        : groups.filter((group) => group.id === groupFilter)
      : [],
  )
  let courseRows = $derived(
    active
      ? buildPlanFactHierarchy({
          courses,
          groups: filteredGroups,
          lessons: filteredLessons,
          plans,
          today,
          search,
        })
      : [],
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

  function dayKey(value: Date) {
    return `${value.getFullYear()}-${value.getMonth()}-${value.getDate()}`
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

  function subjectRowKey(courseNumber: number, subject: string) {
    return `subj:${courseNumber}:${subject}`
  }
  function groupRowKey(courseNumber: number, subject: string, groupId: string) {
    return `grp:${courseNumber}:${subject}:${groupId}`
  }
  function planCellKey(
    courseNumber: number,
    subject: string,
    level: 'subject' | 'group' | 'type',
    type: LessonType | null,
    groupId?: string,
  ) {
    return `plan:${level}:${courseNumber}:${subject}:${type || 'all'}:${groupId || 'all'}`
  }

  function isSubjectExpanded(courseNumber: number, subject: string) {
    return expandedSubjects.has(subjectRowKey(courseNumber, subject))
  }
  function isGroupExpanded(courseNumber: number, subject: string, groupId: string) {
    return expandedGroups.has(groupRowKey(courseNumber, subject, groupId))
  }
  function toggleSubject(courseNumber: number, subject: string) {
    const key = subjectRowKey(courseNumber, subject)
    const next = new Set(expandedSubjects)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    expandedSubjects = next
  }
  function toggleGroup(courseNumber: number, subject: string, groupId: string) {
    const key = groupRowKey(courseNumber, subject, groupId)
    const next = new Set(expandedGroups)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    expandedGroups = next
  }

  function expandAll() {
    const subjects = new Set<string>()
    const groups = new Set<string>()
    visibleRows.forEach((course) => {
      course.subjects.forEach((subject) => {
        subjects.add(subjectRowKey(course.course, subject.subject))
        subject.groups.forEach((group) => {
          groups.add(groupRowKey(course.course, subject.subject, group.groupId))
        })
      })
    })
    expandedSubjects = subjects
    expandedGroups = groups
  }
  function collapseAll() {
    expandedSubjects = new Set()
    expandedGroups = new Set()
  }

  function currentPlan(courseNumber: number) {
    return plans[courseNumber] || flatPlan
  }

  function getSubjectPlan(courseNumber: number, subject: string): number | undefined {
    return currentPlan(courseNumber)[planKey(subject)]
  }
  function getGroupPlan(
    courseNumber: number,
    subject: string,
    groupId: string,
  ): number | undefined {
    return currentPlan(courseNumber)[planKey(subject, null, groupId)]
  }
  function getGroupTypePlan(
    courseNumber: number,
    subject: string,
    groupId: string,
    type: LessonType,
  ): number | undefined {
    if (type === 'unknown') return undefined
    return currentPlan(courseNumber)[planKey(subject, type, groupId)]
  }

  function inputValue(key: string, saved: number | undefined, resolved: number | null = null) {
    if (planInputs[key] !== undefined) return planInputs[key]
    if (saved !== undefined) return String(saved)
    if (resolved !== null) return String(resolved)
    return ''
  }

  function setInput(key: string, value: string) {
    planInputs = { ...planInputs, [key]: value }
    if (saveStatus[key] === 'saved') {
      const next = { ...saveStatus }
      delete next[key]
      saveStatus = next
      const timer = savedTimers.get(key)
      if (timer) {
        clearTimeout(timer)
        savedTimers.delete(key)
      }
    }
  }

  function hasChange(key: string, saved: number | undefined, resolved: number | null = null) {
    const current = (planInputs[key] ?? '').trim()
    if (current === '' && saved === undefined) return false
    const effectiveValue = saved !== undefined ? saved : resolved
    return current !== String(effectiveValue ?? '')
  }

  function inputState(key: string, changed: boolean, saving: boolean): 'idle' | 'changed' | 'saving' | 'saved' | 'error' {
    if (saving) return 'saving'
    if (saveStatus[key] === 'saved') return 'saved'
    if (saveStatus[key] === 'error') return 'error'
    if (changed) return 'changed'
    return 'idle'
  }

  async function persistEntry(
    key: string,
    entry: CoursePlanEntry,
  ) {
    const existingTimer = savedTimers.get(key)
    if (existingTimer) {
      clearTimeout(existingTimer)
      savedTimers.delete(key)
    }
    savingRows = { ...savingRows, [key]: true }
    try {
      await onPlanChange(entry)
      const nextInputs = { ...planInputs }
      delete nextInputs[key]
      planInputs = nextInputs
      saveStatus = { ...saveStatus, [key]: 'saved' }
      const timer = setTimeout(() => {
        const next = { ...saveStatus }
        if (next[key] === 'saved') {
          delete next[key]
          saveStatus = next
        }
        savedTimers.delete(key)
      }, 2000)
      savedTimers.set(key, timer)
    } catch (error) {
      saveStatus = { ...saveStatus, [key]: 'error' }
      alert(`Не удалось сохранить план: ${(error as Error).message}`)
    } finally {
      savingRows = { ...savingRows, [key]: false }
    }
  }

  async function saveSubjectPlan(courseNumber: number, subject: string) {
    const key = planCellKey(courseNumber, subject, 'subject', null)
    const parsed = parseInt(planInputs[key] ?? '', 10)
    if (Number.isNaN(parsed) || parsed < 0) return
    await persistEntry(key, {
      course: courseNumber,
      subject,
      planned_pairs: parsed,
    })
  }

  async function saveGroupPlan(
    courseNumber: number,
    subject: string,
    groupId: string,
  ) {
    const key = planCellKey(courseNumber, subject, 'group', null, groupId)
    const parsed = parseInt(planInputs[key] ?? '', 10)
    if (Number.isNaN(parsed) || parsed < 0) return
    await persistEntry(key, {
      course: courseNumber,
      subject,
      planned_pairs: parsed,
      group: groupId,
    })
  }

  async function saveGroupTypePlan(
    courseNumber: number,
    subject: string,
    groupId: string,
    type: LessonType,
  ) {
    if (type === 'unknown') return
    const key = planCellKey(courseNumber, subject, 'type', type, groupId)
    const parsed = parseInt(planInputs[key] ?? '', 10)
    if (Number.isNaN(parsed) || parsed < 0) return
    await persistEntry(key, {
      course: courseNumber,
      subject,
      planned_pairs: parsed,
      group: groupId,
      lesson_type: type,
    })
  }

  function exportCsv() {
    const header = ['Курс', 'Предмет', 'Тип', 'Группа', 'Подгруппа', 'План', 'В расписании', 'Проведено', 'Осталось', '%']
    const rows: (string | number)[][] = []

    visibleRows.forEach((courseRow) => {
      courseRow.subjects.forEach((subject) => {
        subject.groups.forEach((group) => {
          if (group.hasSubgroups) {
            group.subgroups.forEach((sg) => {
              sg.types.forEach((t) => {
                rows.push([
                  courseRow.course,
                  subject.subject,
                  getLessonTypeLabel(t.type),
                  group.groupName,
                  subgroupLabel(sg.subgroup),
                  t.cell.planned ?? '',
                  t.cell.scheduled,
                  t.cell.done,
                  remaining(t.cell.planned, t.cell.done) ?? '',
                  progressPercent(t.cell.planned, t.cell.done) ?? '',
                ])
              })
            })
          } else {
            group.types.forEach((t) => {
              rows.push([
                courseRow.course,
                subject.subject,
                getLessonTypeLabel(t.type),
                group.groupName,
                '',
                t.cell.planned ?? '',
                t.cell.scheduled,
                t.cell.done,
                remaining(t.cell.planned, t.cell.done) ?? '',
                progressPercent(t.cell.planned, t.cell.done) ?? '',
              ])
            })
          }
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

  function subgroupLabel(subgroup: string | null) {
    return subgroup ? `${subgroup} пг` : 'вся группа'
  }

  function parityLabel(parity: SubgroupParity) {
    if (parity === 'even') return 'чет'
    if (parity === 'odd') return 'нечет'
    if (parity === 'mixed') return 'чет/нечет'
    return ''
  }

  function planSourceLabel(source: PlanFactTypeRowExport['plannedSource']) {
    switch (source) {
      case 'subject':
        return 'план предмета'
      case 'subject-type':
        return 'план (тип предмета)'
      case 'group':
        return 'план группы'
      case 'group-type':
        return 'план группы (тип)'
      case 'subgroup':
        return 'план подгруппы'
      case 'subgroup-type':
        return 'план подгруппы (тип)'
      default:
        return ''
    }
  }
</script>

<div class="analytics-page">
  <div class="analytics-summary">
    <div class="summary-metric">
      {#key summary.planned}
        <span class="inline-block animate-value-pop">{summary.planned || '—'}</span>
      {/key}
      <small>план</small>
    </div>
    <div class="summary-metric">
      {#key summary.scheduled}
        <span class="inline-block animate-value-pop">{summary.scheduled}</span>
      {/key}
      <small>расп.</small>
    </div>
    <div class="summary-metric">
      {#key summary.done}
        <span class="inline-block animate-value-pop">{summary.done}</span>
      {/key}
      <small>пров.</small>
    </div>
    <div class="summary-metric">
      {#key completion}
        <span class="inline-block animate-value-pop">{completion !== null ? `${completion}%` : '—'}</span>
      {/key}
      <small>итог</small>
    </div>
    <div class="ml-auto flex items-center gap-1.5">
      <Button variant="ghost" class="h-8 px-3 text-xs" onclick={expandAll}>
        Развернуть
      </Button>
      <Button variant="ghost" class="h-8 px-3 text-xs" onclick={collapseAll}>
        Свернуть
      </Button>
      <Button variant="secondary" class="h-8 px-3 text-xs" onclick={exportCsv}>
        <Download class="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-y-px" />
        CSV
      </Button>
    </div>
  </div>

  {#if visibleRows.length === 0}
    <Card contentClass="py-12 text-center">
      <div class="text-sm font-semibold">{search ? 'Ничего не найдено' : 'Нет данных'}</div>
      <div class="mt-1 text-sm text-muted-foreground">Измените курс, группу, тип занятия или поиск.</div>
    </Card>
  {:else}
    {#each visibleRows as courseRow, courseIndex (courseRow.course)}
      <section class="plan-course" style={`animation-delay: ${courseIndex * 60}ms`}>
        {#if course === 'all'}
          <div class="plan-course-title">{courseRow.course} курс</div>
        {/if}

        <div class="plan-table-wrap">
          <table class="plan-table">
            <thead>
              <tr>
                <th class="plan-col-toggle"></th>
                <th class="plan-col-subject">Предмет</th>
                <th class="plan-col-type">Тип</th>
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
                {@const subjectSaved = getSubjectPlan(courseRow.course, subject.subject)}
                {@const subjectKeyId = planCellKey(courseRow.course, subject.subject, 'subject', null)}
                {@const subjectChanged = hasChange(subjectKeyId, subjectSaved, null)}
                {@const subjectExpanded = isSubjectExpanded(courseRow.course, subject.subject)}
                {@const subjectPercent = progressPercent(subject.totalPlanned || null, subject.totalDone)}
                <tr class="plan-row plan-row-subject">
                  <td class="plan-col-toggle">
                    <button
                      type="button"
                      class="plan-toggle"
                      onclick={() => toggleSubject(courseRow.course, subject.subject)}
                      aria-label={subjectExpanded ? 'Свернуть предмет' : 'Развернуть предмет'}
                      title={subjectExpanded ? 'Свернуть' : 'Развернуть'}
                    >
                      {#if subjectExpanded}
                        <ChevronDown class="h-4 w-4" />
                      {:else}
                        <ChevronRight class="h-4 w-4" />
                      {/if}
                    </button>
                  </td>
                  <td class="plan-col-subject" colspan={subjectExpanded ? 1 : 4}>
                    <div class="plan-subject-name" title={subject.subject}>{subject.subject}</div>
                    <div class="plan-subject-types">
                      {#each subject.types as type, i (type)}
                        {#if i > 0}<span class="plan-subject-types-sep">·</span>{/if}
                        <span class="plan-subject-type-chip">{getLessonTypeLabel(type)}</span>
                      {/each}
                    </div>
                  </td>
                  {#if subjectExpanded}
                    <td class="plan-col-type plan-col-group-empty">—</td>
                    <td class="plan-col-group plan-col-group-empty">—</td>
                  {/if}
                  <td class="plan-col-plan">
                    <div class="plan-input-group" data-state={inputState(subjectKeyId, subjectChanged, !!savingRows[subjectKeyId])}>
                      <Input
                        class="plan-input"
                        type="number"
                        min={0}
                        value={inputValue(subjectKeyId, subjectSaved)}
                        placeholder="—"
                        oninput={(event) => setInput(subjectKeyId, event.currentTarget.value)}
                        onkeydown={(event) => {
                          if (event.key === 'Enter' && subjectChanged) {
                            void saveSubjectPlan(courseRow.course, subject.subject)
                          }
                        }}
                      />
                      {#if savingRows[subjectKeyId]}
                        <span class="plan-input-status-icon" title="Сохранение...">
                          <Loader2 class="h-3.5 w-3.5 animate-spin" />
                        </span>
                      {:else if subjectChanged}
                        <Button
                          variant="primary"
                          class="plan-input-save"
                          onclick={() => void saveSubjectPlan(courseRow.course, subject.subject)}
                          title="Сохранить план предмета"
                          aria-label="Сохранить план предмета"
                        >
                          <Save class="h-3.5 w-3.5" />
                        </Button>
                      {:else if saveStatus[subjectKeyId] === 'saved'}
                        <span class="plan-input-status plan-input-status-saved" title="Сохранено">
                          <Check class="h-3.5 w-3.5" />
                          Сохранено
                        </span>
                      {:else if saveStatus[subjectKeyId] === 'error'}
                        <span class="plan-input-status plan-input-status-error" title="Ошибка сохранения">
                          <X class="h-3.5 w-3.5" />
                          Ошибка
                        </span>
                      {/if}
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
                        {#key subjectPercent}
                          <span class="inline-block animate-value-pop">
                            {subjectPercent === null ? '—' : `${subjectPercent}%`}
                          </span>
                        {/key}
                      </span>
                    </div>
                  </td>
                </tr>

                {#if subjectExpanded}
                  {#each subject.groups as group (`${courseRow.course}-${subject.subject}-${group.groupId}`)}
                    {@const groupSaved = getGroupPlan(courseRow.course, subject.subject, group.groupId)}
                    {@const groupKeyId = planCellKey(courseRow.course, subject.subject, 'group', null, group.groupId)}
                    {@const groupResolved = group.totalPlanned > 0 ? group.totalPlanned : null}
                    {@const groupChanged = hasChange(groupKeyId, groupSaved, groupResolved)}
                    {@const groupExpanded = isGroupExpanded(courseRow.course, subject.subject, group.groupId)}
                    {@const groupPercent = progressPercent(group.totalPlanned || null, group.totalDone)}
                    <tr class="plan-row plan-row-group">
                      <td class="plan-col-toggle">
                        {#if group.hasSubgroups || group.types.length > 1}
                          <button
                            type="button"
                            class="plan-toggle"
                            onclick={() => toggleGroup(courseRow.course, subject.subject, group.groupId)}
                            aria-label={groupExpanded ? 'Свернуть группу' : 'Развернуть группу'}
                            title={groupExpanded ? 'Свернуть' : 'Развернуть'}
                          >
                            {#if groupExpanded}
                              <ChevronDown class="h-4 w-4" />
                            {:else}
                              <ChevronRight class="h-4 w-4" />
                            {/if}
                          </button>
                        {/if}
                      </td>
                      <td class="plan-col-subject plan-col-group-cell">
                        <div class="plan-group-line">
                          <span class="plan-group-name">{group.groupName}</span>
                          {#if group.department}
                            <span class="plan-group-dept-inline">{group.department}</span>
                          {/if}
                        </div>
                      </td>
                      <td class="plan-col-type plan-col-group-empty"></td>
                      <td class="plan-col-group plan-col-group-empty"></td>
                      <td class="plan-col-plan">
                        <div class="plan-input-group" data-state={inputState(groupKeyId, groupChanged, !!savingRows[groupKeyId])}>
                          <Input
                            class="plan-input"
                            type="number"
                            min={0}
                            value={inputValue(groupKeyId, groupSaved, groupResolved)}
                            placeholder="—"
                            oninput={(event) => setInput(groupKeyId, event.currentTarget.value)}
                            onkeydown={(event) => {
                              if (event.key === 'Enter' && groupChanged) {
                                void saveGroupPlan(courseRow.course, subject.subject, group.groupId)
                              }
                            }}
                          />
                          {#if savingRows[groupKeyId]}
                            <span class="plan-input-status-icon" title="Сохранение...">
                              <Loader2 class="h-3.5 w-3.5 animate-spin" />
                            </span>
                          {:else if groupChanged}
                            <Button
                              variant="primary"
                              class="plan-input-save"
                              onclick={() => void saveGroupPlan(courseRow.course, subject.subject, group.groupId)}
                              title="План для группы (переопределяет план предмета)"
                              aria-label="Сохранить план группы"
                            >
                              <Save class="h-3.5 w-3.5" />
                            </Button>
                          {:else if saveStatus[groupKeyId] === 'saved'}
                            <span class="plan-input-status plan-input-status-saved" title="Сохранено">
                              <Check class="h-3.5 w-3.5" />
                              Сохранено
                            </span>
                          {:else if saveStatus[groupKeyId] === 'error'}
                            <span class="plan-input-status plan-input-status-error" title="Ошибка сохранения">
                              <X class="h-3.5 w-3.5" />
                              Ошибка
                            </span>
                          {/if}
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
                            {#key groupPercent}
                              <span class="inline-block animate-value-pop">
                                {groupPercent === null ? '—' : `${groupPercent}%`}
                              </span>
                            {/key}
                          </span>
                        </div>
                      </td>
                    </tr>

                    {#if groupExpanded}
                      {#if group.hasSubgroups}
                        {#each group.subgroups as subgroup (subgroup.subgroup || 'all')}
                          {@const sgPercent = progressPercent(subgroup.cell.planned, subgroup.cell.done)}
                          <tr class="plan-row plan-row-subgroup">
                            <td class="plan-col-toggle"></td>
                            <td class="plan-col-subject"></td>
                            <td class="plan-col-type-group" colspan="2">
                              <div class="plan-subgroup-content">
                                <div class="plan-subgroup-meta">
                                  <span class="plan-subgroup-label">
                                    {subgroupLabel(subgroup.subgroup)}
                                  </span>
                                  {#if parityLabel(subgroup.parity)}
                                    <span class="plan-subgroup-parity">{parityLabel(subgroup.parity)}</span>
                                  {/if}
                                </div>
                                <div class="plan-type-input-list">
                                  {#each subgroup.types as typeRow (typeRow.type)}
                                    {@const typeKeyId = planCellKey(courseRow.course, subject.subject, 'type', typeRow.type, group.groupId)}
                                    {@const typeSaved = typeRow.type !== 'unknown' ? getGroupTypePlan(courseRow.course, subject.subject, group.groupId, typeRow.type) : undefined}
                                    {@const typeResolved = typeRow.cell.planned}
                                    {@const typeChanged = typeRow.type !== 'unknown' ? hasChange(typeKeyId, typeSaved, typeResolved) : false}
                                    <div class="plan-type-input-pair">
                                      <span class="plan-type-chip">{getLessonTypeLabel(typeRow.type)}</span>
                                      {#if typeRow.type !== 'unknown'}
                                        <div class="plan-input-group plan-input-group-compact" data-state={inputState(typeKeyId, typeChanged, !!savingRows[typeKeyId])}>
                                          <Input
                                            class="plan-input"
                                            type="number"
                                            min={0}
                                            value={inputValue(typeKeyId, typeSaved, typeResolved)}
                                            placeholder="—"
                                            title={planSourceLabel(typeRow.plannedSource)}
                                            oninput={(event) => setInput(typeKeyId, event.currentTarget.value)}
                                            onkeydown={(event) => {
                                              if (event.key === 'Enter' && typeChanged) {
                                                void saveGroupTypePlan(courseRow.course, subject.subject, group.groupId, typeRow.type)
                                              }
                                            }}
                                          />
                                          {#if savingRows[typeKeyId]}
                                            <span class="plan-input-status-icon plan-input-status-icon-compact" title="Сохранение...">
                                              <Loader2 class="h-3 w-3 animate-spin" />
                                            </span>
                                          {:else if typeChanged}
                                            <Button
                                              variant="primary"
                                              class="plan-input-save"
                                              onclick={() => void saveGroupTypePlan(courseRow.course, subject.subject, group.groupId, typeRow.type)}
                                              title="Сохранить план типа для группы"
                                              aria-label="Сохранить план типа для группы"
                                            >
                                              <Save class="h-3 w-3" />
                                            </Button>
                                          {:else if saveStatus[typeKeyId] === 'saved'}
                                            <span class="plan-input-status plan-input-status-saved plan-input-status-compact" title="Сохранено">
                                              <Check class="h-3 w-3" />
                                            </span>
                                          {:else if saveStatus[typeKeyId] === 'error'}
                                            <span class="plan-input-status plan-input-status-error plan-input-status-compact" title="Ошибка сохранения">
                                              <X class="h-3 w-3" />
                                            </span>
                                          {/if}
                                        </div>
                                      {/if}
                                    </div>
                                  {/each}
                                </div>
                              </div>
                            </td>
                            <td class="plan-col-plan plan-col-plan-readonly" title={planSourceLabel(subgroup.cell.planned !== null ? 'group' : 'none')}>
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
                                  {#key sgPercent}
                                    <span class="inline-block animate-value-pop">
                                      {sgPercent === null ? '—' : `${sgPercent}%`}
                                    </span>
                                  {/key}
                                </span>
                              </div>
                            </td>
                          </tr>
                        {/each}
                      {:else}
                        {#each group.types as typeRow (typeRow.type)}
                          {@const typeKeyId = planCellKey(courseRow.course, subject.subject, 'type', typeRow.type, group.groupId)}
                          {@const typeSaved = typeRow.type !== 'unknown' ? getGroupTypePlan(courseRow.course, subject.subject, group.groupId, typeRow.type) : undefined}
                          {@const typeResolved = typeRow.cell.planned}
                          {@const typeChanged = typeRow.type !== 'unknown' ? hasChange(typeKeyId, typeSaved, typeResolved) : false}
                          {@const tPercent = progressPercent(typeRow.cell.planned, typeRow.cell.done)}
                          <tr class="plan-row plan-row-type">
                            <td class="plan-col-toggle"></td>
                            <td class="plan-col-subject"></td>
                            <td class="plan-col-type">
                              <span class="plan-type-chip">{getLessonTypeLabel(typeRow.type)}</span>
                            </td>
                            <td class="plan-col-group plan-col-group-empty">—</td>
                            <td class="plan-col-plan">
                              {#if typeRow.type !== 'unknown'}
                                <div class="plan-input-group" data-state={inputState(typeKeyId, typeChanged, !!savingRows[typeKeyId])}>
                                  <Input
                                    class="plan-input"
                                    type="number"
                                    min={0}
                                    value={inputValue(typeKeyId, typeSaved, typeResolved)}
                                    placeholder="—"
                                    oninput={(event) => setInput(typeKeyId, event.currentTarget.value)}
                                    onkeydown={(event) => {
                                      if (event.key === 'Enter' && typeChanged) {
                                        void saveGroupTypePlan(courseRow.course, subject.subject, group.groupId, typeRow.type)
                                      }
                                    }}
                                  />
                                  {#if savingRows[typeKeyId]}
                                    <span class="plan-input-status-icon" title="Сохранение...">
                                      <Loader2 class="h-3.5 w-3.5 animate-spin" />
                                    </span>
                                  {:else if typeChanged}
                                    <Button
                                      variant="primary"
                                      class="plan-input-save"
                                      onclick={() => void saveGroupTypePlan(courseRow.course, subject.subject, group.groupId, typeRow.type)}
                                      title="Сохранить план типа для группы"
                                      aria-label="Сохранить план типа для группы"
                                    >
                                      <Save class="h-3.5 w-3.5" />
                                    </Button>
                                  {:else if saveStatus[typeKeyId] === 'saved'}
                                    <span class="plan-input-status plan-input-status-saved" title="Сохранено">
                                      <Check class="h-3.5 w-3.5" />
                                      Сохранено
                                    </span>
                                  {:else if saveStatus[typeKeyId] === 'error'}
                                    <span class="plan-input-status plan-input-status-error" title="Ошибка сохранения">
                                      <X class="h-3.5 w-3.5" />
                                      Ошибка
                                    </span>
                                  {/if}
                                </div>
                              {:else}
                                <span class="plan-col-plan-readonly" title={planSourceLabel(typeRow.plannedSource)}>
                                  {typeRow.cell.planned ?? '—'}
                                </span>
                              {/if}
                            </td>
                            <td class={cn('plan-col-num plan-num', statusTone(typeRow.cell))}>
                              {typeRow.cell.scheduled}
                            </td>
                            <td class="plan-col-num plan-num plan-num-done">{typeRow.cell.done}</td>
                            <td class="plan-col-num plan-num plan-num-remain">
                              {remaining(typeRow.cell.planned, typeRow.cell.done) ?? '—'}
                            </td>
                            <td class="plan-col-progress">
                              <div class="plan-progress">
                                <div class="plan-progress-track">
                                  <div
                                    class={cn('plan-progress-bar', statusClass(statusColor(typeRow.cell)))}
                                    style={`width: ${tPercent === null ? 0 : Math.min(tPercent, 100)}%`}
                                  ></div>
                                </div>
                                <span class="plan-progress-label">
                                  {#key tPercent}
                                    <span class="inline-block animate-value-pop">
                                      {tPercent === null ? '—' : `${tPercent}%`}
                                    </span>
                                  {/key}
                                </span>
                              </div>
                            </td>
                          </tr>
                        {/each}
                      {/if}
                    {/if}
                  {/each}
                {/if}
              {/each}
            </tbody>
          </table>
        </div>
      </section>
    {/each}
  {/if}
</div>
