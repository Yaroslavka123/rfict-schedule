import { Download, Save } from 'lucide-react'
import { useMemo, useState } from 'react'

import { planKey } from '@/api/scheduleClient'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { buildSubjectPlanRows, getCourseSubjects, progress, statusColor } from '@/lib/schedule'
import { cn } from '@/lib/utils'
import type {
  AnalyticsCell,
  CoursePlanEntry,
  CoursePlanMap,
  ScheduleGroup,
  ScheduleLesson,
  SubgroupParity,
  SubjectPlanRow,
} from '@/types/schedule'

interface AnalyticsViewProps {
  course: number
  groups: ScheduleGroup[]
  lessons: ScheduleLesson[]
  plan: CoursePlanMap
  groupFilter: string
  onPlanChange: (entry: CoursePlanEntry) => Promise<void> | void
}

export function AnalyticsView({ course, groups, lessons, plan, groupFilter, onPlanChange }: AnalyticsViewProps) {
  const today = useMemo(() => new Date(), [])
  const subjectRows = useMemo(
    () => buildSubjectPlanRows({ plan, groups, lessons, today }),
    [plan, groups, lessons, today],
  )

  const visibleRows = useMemo(() => {
    if (groupFilter === 'all') return subjectRows
    return subjectRows
      .map((row) => ({
        ...row,
        groups: row.groups.filter((group) => group.groupId === groupFilter),
      }))
      .filter((row) => row.groups.length > 0)
  }, [subjectRows, groupFilter])

  const subjects = useMemo(() => getCourseSubjects(lessons), [lessons])

  const exportCsv = () => {
    const header = ['Предмет', 'Группа', 'Подгруппа', 'Чёт/нечёт', 'План', 'В расписании', 'Проведено', 'Осталось']
    const rows: (string | number)[][] = []
    visibleRows.forEach((row) => {
      row.groups.forEach((group) => {
        group.subgroups.forEach((subgroup) => {
          const remaining = subgroup.cell.planned !== null ? subgroup.cell.planned - subgroup.cell.done : ''
          rows.push([
            row.subject,
            group.groupName,
            subgroup.subgroup || 'Группа целиком',
            parityLabel(subgroup.parity),
            subgroup.cell.planned ?? '',
            subgroup.cell.scheduled,
            subgroup.cell.done,
            remaining,
          ])
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
    link.download = `plan-fact-course-${course}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-muted-foreground">План-факт по {course} курсу</h2>
        <span className="text-xs text-muted-foreground">на {today.toLocaleDateString('ru-RU')}</span>
        <Button variant="secondary" className="ml-auto h-9" onClick={exportCsv}>
          <Download className="h-4 w-4" />
          CSV
        </Button>
      </div>

      <PlanEditor course={course} subjects={subjects} plan={plan} onPlanChange={onPlanChange} />

      <p className="text-xs text-muted-foreground">
        План задаётся один раз на курс — он применяется ко всем группам и подгруппам предмета. Чётная неделя — одна
        подгруппа, нечётная — другая.
      </p>

      {visibleRows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Нет данных. Выберите курс или задайте план по предметам.
          </CardContent>
        </Card>
      ) : (
        visibleRows.map((row) => <SubjectRow key={row.subject} row={row} />)
      )}
    </div>
  )
}

function SubjectRow({ row }: { row: SubjectPlanRow }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/40 px-3 py-2">
        <div className="min-w-0">
          <span className="text-sm font-bold">{row.subject}</span>
          <span className="ml-2 text-xs text-muted-foreground">
            план: {row.planned ?? '—'} · в расписании: {row.totalScheduled} · проведено: {row.totalDone}
          </span>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="dense-table">
          <thead>
            <tr>
              <th className="text-left">Группа</th>
              <th className="text-left">Подгруппа</th>
              <th className="w-24 text-left">Чёт/нечёт</th>
              <th className="w-20 text-right">План</th>
              <th className="w-24 text-right">В расписании</th>
              <th className="w-24 text-right">Проведено</th>
              <th className="w-24 text-right">Осталось</th>
              <th className="w-32 text-right">Прогресс</th>
            </tr>
          </thead>
          <tbody>
            {row.groups.flatMap((group) =>
              group.subgroups.map((subgroup, idx) => {
                const color = statusColor(subgroup.cell)
                const prog = progress(subgroup.cell)
                const remaining =
                  subgroup.cell.planned !== null ? subgroup.cell.planned - subgroup.cell.done : null
                return (
                  <tr key={`${group.groupId}-${subgroup.subgroup ?? 'all'}-${idx}`}>
                    <td className="font-semibold">{group.groupName}</td>
                    <td className="text-muted-foreground">
                      {subgroup.subgroup || <span className="italic">целиком</span>}
                    </td>
                    <td>
                      <ParityBadge parity={subgroup.parity} />
                    </td>
                    <td className="text-right tabular-nums">
                      {subgroup.cell.planned ?? <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className={cn('text-right tabular-nums', toneClass(color))}>
                      {subgroup.cell.scheduled}
                    </td>
                    <td className="text-right tabular-nums">{subgroup.cell.done}</td>
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
                      {subgroup.cell.planned !== null ? (
                        <div className="ml-auto flex w-28 items-center gap-2">
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                            <div
                              className={cn('h-full', barClass(color))}
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
              }),
            )}
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
        className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-semibold transition hover:bg-muted/40"
        onClick={() => setOpen((value) => !value)}
      >
        <span>
          План по предметам ({filledCount}/{subjects.length})
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
