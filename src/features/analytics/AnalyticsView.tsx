import { Download, Save } from 'lucide-react'
import { useMemo, useState } from 'react'

import { planKey } from '@/api/scheduleClient'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
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
  ScheduleGroup,
  ScheduleGroupWithCourse,
  ScheduleLesson,
  SubgroupParity,
} from '@/types/schedule'

interface AnalyticsViewProps {
  course: CourseSelection
  groups: (ScheduleGroup | ScheduleGroupWithCourse)[]
  lessons: ScheduleLesson[]
  plans: Record<number, CoursePlanMap>
  flatPlan: CoursePlanMap
  groupFilter: string
  subgroupFilter: string
  search: string
  onPlanChange: (entry: CoursePlanEntry) => Promise<void> | void
}

interface SubjectGroupRow {
  groupId: string
  groupName: string
  department?: string
  subgroups: {
    subgroup: string | null
    parity: SubgroupParity
    cell: AnalyticsCell
  }[]
  totalPlanned: number
  totalScheduled: number
  totalDone: number
}

interface SubjectRow {
  subject: string
  groups: SubgroupGroupRow[]
  totalPlanned: number
  totalScheduled: number
  totalDone: number
}

type SubgroupGroupRow = SubjectGroupRow

interface CourseSubjectRow {
  course: number
  subjects: SubjectRow[]
  totalPlanned: number
  totalScheduled: number
  totalDone: number
}

/**
 * Plan-fact: course → subject → group → subgroup hierarchy.
 * Each subject card lists every group that runs it (with per-subgroup status).
 */
export function AnalyticsView({
  course,
  groups,
  lessons,
  plans,
  flatPlan,
  groupFilter,
  subgroupFilter,
  search,
  onPlanChange,
}: AnalyticsViewProps) {
  const today = useMemo(() => new Date(), [])

  const courses = useMemo<number[]>(() => {
    if (course === 'all') return Object.keys(plans).map(Number).sort((a, b) => a - b)
    return [course]
  }, [course, plans])

  const courseRows = useMemo(
    () =>
      buildPlanFactHierarchy({
        courses,
        groups,
        lessons,
        plans,
        today,
        search,
      }),
    [courses, groups, lessons, plans, today, search],
  )

  const subjectRows = useMemo<CourseSubjectRow[]>(
    () => courseRows.map((row) => regroupBySubject(row, groupFilter, subgroupFilter)),
    [courseRows, groupFilter, subgroupFilter],
  )

  const visibleRows = useMemo(
    () => subjectRows.filter((row) => row.subjects.length > 0),
    [subjectRows],
  )

  const subjectsByCourse = useMemo(() => {
    const map: Record<number, string[]> = {}
    courses.forEach((c) => {
      const courseLessons = lessons.filter((lesson) => {
        if (lesson.course_number !== undefined) return lesson.course_number === c
        const g = groups.find((gr) => gr.id === lesson.group) as ScheduleGroupWithCourse | undefined
        if (g?.course !== undefined) return g.course === c
        return course !== 'all'
      })
      map[c] = getCourseSubjects(courseLessons)
    })
    return map
  }, [courses, lessons, groups, course])

  const exportCsv = () => {
    const header = [
      'Курс',
      'Предмет',
      'Группа',
      'Подгруппа',
      'Чёт/нечёт',
      'План',
      'В расписании',
      'Проведено',
      'Осталось',
    ]
    const rows: (string | number)[][] = []
    visibleRows.forEach((courseRow) => {
      courseRow.subjects.forEach((subject) => {
        subject.groups.forEach((group) => {
          group.subgroups.forEach((sg) => {
            const remaining = sg.cell.planned !== null ? sg.cell.planned - sg.cell.done : ''
            rows.push([
              courseRow.course,
              subject.subject,
              group.groupName,
              sg.subgroup || 'целиком',
              parityLabel(sg.parity),
              sg.cell.planned ?? '',
              sg.cell.scheduled,
              sg.cell.done,
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

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-muted-foreground">
          План-факт {course === 'all' ? 'по всем курсам' : `по ${course} курсу`}
        </h2>
        <span className="text-xs text-muted-foreground">на {today.toLocaleDateString('ru-RU')}</span>
        <Button variant="secondary" className="ml-auto h-9" onClick={exportCsv}>
          <Download className="h-4 w-4" />
          CSV
        </Button>
      </div>

      {courses.map((c) => (
        <PlanEditor
          key={c}
          course={c}
          subjects={subjectsByCourse[c] || []}
          plan={plans[c] || flatPlan}
          onPlanChange={onPlanChange}
        />
      ))}

      <p className="text-xs text-muted-foreground">
        План задаётся один раз на курс — он применяется ко всем группам и подгруппам предмета. Чётная неделя — одна
        подгруппа, нечётная — другая.
      </p>

      {visibleRows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            {search ? 'По запросу ничего не найдено.' : 'Нет данных. Выберите курс или задайте план по предметам.'}
          </CardContent>
        </Card>
      ) : (
        visibleRows.map((row) => <CourseBlock key={row.course} row={row} multiCourse={courses.length > 1} />)
      )}
    </div>
  )
}

function CourseBlock({ row, multiCourse }: { row: CourseSubjectRow; multiCourse: boolean }) {
  return (
    <div className="space-y-2">
      {multiCourse && (
        <div className="flex items-center justify-between gap-3 px-1 pt-1">
          <h3 className="text-sm font-bold text-primary">{row.course} курс</h3>
          <span className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>план: {row.totalPlanned || '—'}</span>
            <span>в расписании: {row.totalScheduled}</span>
            <span>проведено: {row.totalDone}</span>
          </span>
        </div>
      )}
      <div className="space-y-2">
        {row.subjects.map((subject) => (
          <SubjectCard key={subject.subject} subject={subject} />
        ))}
      </div>
    </div>
  )
}

function SubjectCard({ subject }: { subject: SubjectRow }) {
  const planAggregate = subject.totalPlanned
  const doneAggregate = subject.totalDone
  const scheduledAggregate = subject.totalScheduled
  const aggregateProgress =
    planAggregate > 0 ? Math.round((doneAggregate / planAggregate) * 100) : null

  return (
    <div className="plan-fact-section">
      <div className="plan-fact-section-header">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold">{subject.subject}</span>
        </div>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span>план: {planAggregate || '—'}</span>
          <span>в расписании: {scheduledAggregate}</span>
          <span>проведено: {doneAggregate}</span>
          {aggregateProgress !== null && (
            <div className="flex w-24 items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    'h-full transition-all duration-300 ease-out',
                    aggregateProgress >= 100 ? 'bg-emerald-500' : aggregateProgress >= 50 ? 'bg-amber-500' : 'bg-red-500',
                  )}
                  style={{ width: `${Math.min(Math.max(aggregateProgress, 0), 100)}%` }}
                />
              </div>
              <span className="text-[10px] tabular-nums">{aggregateProgress}%</span>
            </div>
          )}
        </div>
      </div>
      <div>
        {subject.groups.map((group) => (
          <GroupRows key={group.groupId} group={group} />
        ))}
      </div>
    </div>
  )
}

function GroupRows({ group }: { group: SubjectGroupRow }) {
  return (
    <>
      <div className="plan-fact-group-row">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-semibold truncate" title={group.groupName}>
            {group.groupName}
          </span>
          {group.department && <span className="text-[10px] text-muted-foreground">· {group.department}</span>}
        </div>
        <div className="text-right text-xs tabular-nums">план: {group.totalPlanned || '—'}</div>
        <div className="text-right text-xs tabular-nums">расп.: {group.totalScheduled}</div>
        <div className="text-right text-xs tabular-nums">пров.: {group.totalDone}</div>
        <div className="text-right text-xs tabular-nums">
          {group.totalPlanned > 0
            ? `${Math.round((group.totalDone / group.totalPlanned) * 100)}%`
            : '—'}
        </div>
      </div>
      {group.subgroups.map((sg, idx) => (
        <div key={`${group.groupId}-${sg.subgroup || idx}`} className="plan-fact-subgroup-row">
          <div className="flex items-center gap-2 min-w-0">
            <span className="opacity-80 truncate">
              {sg.subgroup ? `${sg.subgroup} пг` : <span className="italic">целиком</span>}
            </span>
            <ParityBadge parity={sg.parity} />
          </div>
          <div className="text-right tabular-nums">
            {sg.cell.planned ?? <span className="opacity-50">—</span>}
          </div>
          <div className={cn('text-right tabular-nums', toneClass(statusColor(sg.cell)))}>
            {sg.cell.scheduled}
          </div>
          <div className="text-right tabular-nums">{sg.cell.done}</div>
          <div className="text-right tabular-nums">
            {sg.cell.planned !== null ? (
              <span>{Math.max(sg.cell.planned - sg.cell.done, 0)}</span>
            ) : (
              <span className="opacity-50">—</span>
            )}
          </div>
        </div>
      ))}
    </>
  )
}

function parityLabel(parity: SubgroupParity) {
  switch (parity) {
    case 'even':
      return 'чёт'
    case 'odd':
      return 'нечёт'
    case 'mixed':
      return 'каждую'
    default:
      return '—'
  }
}

function ParityBadge({ parity }: { parity: SubgroupParity }) {
  const label = parityLabel(parity)
  const cls =
    parity === 'even'
      ? 'bg-sky-500/15 text-sky-500'
      : parity === 'odd'
      ? 'bg-amber-500/15 text-amber-500'
      : parity === 'mixed'
      ? 'bg-emerald-500/15 text-emerald-500'
      : 'bg-muted text-muted-foreground'
  return (
    <span className={cn('inline-block rounded px-1 py-0.5 text-[9px] font-bold uppercase tracking-wider', cls)}>
      {label}
    </span>
  )
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

interface PlanEditorProps {
  course: number
  subjects: string[]
  plan: CoursePlanMap
  onPlanChange: (entry: CoursePlanEntry) => Promise<void> | void
}

function PlanEditor({ course, subjects, plan, onPlanChange }: PlanEditorProps) {
  const [open, setOpen] = useState(false)
  if (subjects.length === 0) return null
  const filledCount = subjects.filter((subject) => plan[planKey(subject)] !== undefined).length
  return (
    <div className="rounded-lg border border-border bg-card">
      <button
        type="button"
        className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-semibold transition-all duration-200 ease-out hover:bg-muted/40"
        onClick={() => setOpen((value) => !value)}
      >
        <span>
          План по предметам · {course} курс ({filledCount}/{subjects.length})
        </span>
        <span className="text-xs text-muted-foreground">{open ? 'скрыть' : 'редактировать'}</span>
      </button>
      {open && (
        <div className="grid grid-cols-1 gap-2 border-t border-border p-3 md:grid-cols-2 lg:grid-cols-3">
          {subjects.map((subject) => (
            <PlanRow
              key={subject}
              subject={subject}
              value={plan[planKey(subject)]}
              onSave={(value) => onPlanChange({ course, subject, planned_pairs: value })}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function PlanRow({ subject, value, onSave }: { subject: string; value: number | undefined; onSave: (value: number) => void | Promise<void> }) {
  const [input, setInput] = useState(value !== undefined ? String(value) : '')
  const [saving, setSaving] = useState(false)
  const hasChange = input.trim() !== (value !== undefined ? String(value) : '')

  const save = async () => {
    const parsed = parseInt(input, 10)
    if (Number.isNaN(parsed) || parsed < 0) return
    setSaving(true)
    try {
      await onSave(parsed)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-background/50 px-2 py-1.5">
      <span className="flex-1 truncate text-sm" title={subject}>
        {subject}
      </span>
      <Input
        className="h-8 w-16 text-center tabular-nums"
        type="number"
        min={0}
        value={input}
        placeholder="—"
        onChange={(event) => setInput(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && hasChange) save()
        }}
      />
      <Button
        variant="ghost"
        className={cn('h-8 w-8 p-0', !hasChange && 'opacity-30')}
        onClick={save}
        disabled={!hasChange || saving}
        title="Сохранить план"
      >
        <Save className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}

// Regroup the buildPlanFactHierarchy output (course → group → subgroup → subject)
// into course → subject → group → subgroup so the Plan-fact UI can render a
// subject-first listing while keeping the same underlying data and parity info.
function regroupBySubject(
  row: PlanFactCourse,
  groupFilter: string,
  subgroupFilter: string,
): CourseSubjectRow {
  const subjectMap = new Map<string, SubjectRow>()

  row.groups
    .filter((g) => groupFilter === 'all' || g.groupId === groupFilter)
    .forEach((group) => {
      group.subgroups
        .filter((sg) => subgroupFilter === 'all' || (sg.subgroup ?? '') === subgroupFilter)
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
            let groupEntry = subjectEntry.groups.find((g) => g.groupId === group.groupId)
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
              parity: subject.parity,
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
    totalPlanned: subjects.reduce((sum, s) => sum + s.totalPlanned, 0),
    totalScheduled: subjects.reduce((sum, s) => sum + s.totalScheduled, 0),
    totalDone: subjects.reduce((sum, s) => sum + s.totalDone, 0),
  }
}

export type { AnalyticsCell }
