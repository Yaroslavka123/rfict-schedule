import { ChevronRight, Download, Save } from 'lucide-react'
import { useMemo, useState } from 'react'

import { planKey } from '@/api/scheduleClient'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  buildPlanFactHierarchy,
  getCourseSubjects,
  progress,
  statusColor,
  type PlanFactCourse,
  type PlanFactGroup,
  type PlanFactSubgroup,
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

  const visibleRows = useMemo(() => {
    return courseRows
      .map((courseRow) => ({
        ...courseRow,
        groups: courseRow.groups
          .filter((g) => groupFilter === 'all' || g.groupId === groupFilter)
          .map((g) => ({
            ...g,
            subgroups: g.subgroups.filter(
              (sg) => subgroupFilter === 'all' || (sg.subgroup ?? '') === subgroupFilter,
            ),
          }))
          .filter((g) => g.subgroups.length > 0),
      }))
      .filter((c) => c.groups.length > 0)
  }, [courseRows, groupFilter, subgroupFilter])

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
    const header = ['Курс', 'Группа', 'Подгруппа', 'Предмет', 'Чёт/нечёт', 'План', 'В расписании', 'Проведено', 'Осталось']
    const rows: (string | number)[][] = []
    visibleRows.forEach((courseRow) => {
      courseRow.groups.forEach((group) => {
        group.subgroups.forEach((subgroup) => {
          subgroup.subjects.forEach((subject) => {
            const remaining = subject.cell.planned !== null ? subject.cell.planned - subject.cell.done : ''
            rows.push([
              courseRow.course,
              group.groupName,
              subgroup.subgroup || 'целиком',
              subject.subject,
              parityLabel(subject.parity),
              subject.cell.planned ?? '',
              subject.cell.scheduled,
              subject.cell.done,
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
      ) : course === 'all' ? (
        visibleRows.map((row) => <CourseAccordion key={row.course} row={row} defaultOpen={visibleRows.length === 1} />)
      ) : (
        visibleRows.map((row) =>
          row.groups.map((group) => <GroupCard key={`${row.course}-${group.groupId}`} group={group} />),
        )
      )}
    </div>
  )
}

function CourseAccordion({ row, defaultOpen }: { row: PlanFactCourse; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <button
        type="button"
        className="accordion-trigger"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="flex items-center gap-2">
          <ChevronRight
            className={cn('h-4 w-4 transition-transform duration-200 ease-out', open && 'rotate-90')}
          />
          {row.course} курс
        </span>
        <span className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>план: {row.totalPlanned || '—'}</span>
          <span>в расписании: {row.totalScheduled}</span>
          <span>проведено: {row.totalDone}</span>
        </span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-border p-2">
          {row.groups.map((group) => (
            <GroupCard key={group.groupId} group={group} />
          ))}
        </div>
      )}
    </div>
  )
}

function GroupCard({ group }: { group: PlanFactGroup }) {
  const [open, setOpen] = useState(true)
  return (
    <div className="rounded-md border border-border bg-card/50 overflow-hidden">
      <button
        type="button"
        className="accordion-trigger"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="flex items-center gap-2">
          <ChevronRight
            className={cn('h-3.5 w-3.5 transition-transform duration-200 ease-out', open && 'rotate-90')}
          />
          <span className="text-sm font-bold">{group.groupName}</span>
          {group.department && (
            <span className="text-[10px] text-muted-foreground">· {group.department}</span>
          )}
        </span>
        <span className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>план: {group.totalPlanned || '—'}</span>
          <span>в расписании: {group.totalScheduled}</span>
          <span>проведено: {group.totalDone}</span>
        </span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-border p-2">
          {group.subgroups.map((subgroup, idx) => (
            <SubgroupBlock key={`${subgroup.subgroup ?? 'all'}-${idx}`} subgroup={subgroup} />
          ))}
        </div>
      )}
    </div>
  )
}

function SubgroupBlock({ subgroup }: { subgroup: PlanFactSubgroup }) {
  return (
    <div className="rounded border border-border/60 bg-background/40">
      <div className="flex items-center justify-between gap-2 border-b border-border/60 bg-muted/30 px-2.5 py-1.5">
        <span className="text-xs font-bold">
          {subgroup.subgroup ? `${subgroup.subgroup} подгруппа` : <span className="text-muted-foreground italic">Группа целиком</span>}
        </span>
        <span className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span>план: {subgroup.totalPlanned || '—'}</span>
          <span>факт: {subgroup.totalDone}/{subgroup.totalScheduled}</span>
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="dense-table">
          <thead>
            <tr>
              <th className="text-left">Предмет</th>
              <th className="w-20 text-left">Чёт/нечёт</th>
              <th className="w-20 text-right">План</th>
              <th className="w-24 text-right">В расписании</th>
              <th className="w-24 text-right">Проведено</th>
              <th className="w-24 text-right">Осталось</th>
              <th className="w-32 text-right">Прогресс</th>
            </tr>
          </thead>
          <tbody>
            {subgroup.subjects.map((subject, idx) => {
              const color = statusColor(subject.cell)
              const prog = progress(subject.cell)
              const remaining =
                subject.cell.planned !== null ? subject.cell.planned - subject.cell.done : null
              return (
                <tr key={`${subject.subject}-${idx}`}>
                  <td className="font-semibold">{subject.subject}</td>
                  <td>
                    <ParityBadge parity={subject.parity} />
                  </td>
                  <td className="text-right tabular-nums">
                    {subject.cell.planned ?? <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className={cn('text-right tabular-nums', toneClass(color))}>
                    {subject.cell.scheduled}
                  </td>
                  <td className="text-right tabular-nums">{subject.cell.done}</td>
                  <td className="text-right tabular-nums">
                    {remaining === null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : remaining < 0 ? (
                      <span className="text-amber-500">+{Math.abs(remaining)}</span>
                    ) : (
                      remaining
                    )}
                  </td>
                  <td className="text-right">
                    {subject.cell.planned !== null ? (
                      <div className="ml-auto flex w-28 items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                          <div
                            className={cn('h-full transition-all duration-500 ease-out', barClass(color))}
                            style={{ width: `${Math.min(Math.max(prog, 0), 120)}%` }}
                          />
                        </div>
                        <span className="text-xs tabular-nums text-muted-foreground">{prog}%</span>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">нет плана</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
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
    <span className={cn('inline-block rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider', cls)}>
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

function barClass(color: ReturnType<typeof statusColor>) {
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
      return 'bg-muted-foreground'
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

export type { AnalyticsCell }
