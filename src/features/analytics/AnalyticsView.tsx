import { Download, Save } from 'lucide-react'
import { useMemo, useState } from 'react'

import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { buildCourseAnalytics, getCourseSubjects, progress, statusColor } from '@/lib/schedule'
import { planKey } from '@/api/scheduleClient'
import { cn } from '@/lib/utils'
import type { AnalyticsCell, CoursePlanEntry, CoursePlanMap, ScheduleGroup, ScheduleLesson } from '@/types/schedule'

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
  const analytics = useMemo(
    () => buildCourseAnalytics({ course, plan, groups, lessons, today }),
    [course, plan, groups, lessons, today],
  )
  const visibleGroups = useMemo(() => {
    if (groupFilter === 'all') return analytics
    return analytics.filter((entry) => entry.groupId === groupFilter)
  }, [analytics, groupFilter])

  const subjects = useMemo(() => getCourseSubjects(lessons), [lessons])

  const exportCsv = () => {
    const header = ['Группа', 'Подгруппа', 'Предмет', 'План', 'В расписании', 'Проведено', 'Осталось']
    const rows: (string | number)[][] = []
    visibleGroups.forEach((group) => {
      group.subgroups.forEach((subgroup) => {
        subgroup.rows.forEach((row) => {
          const remaining = row.cell.planned !== null ? row.cell.planned - row.cell.done : ''
          rows.push([
            group.groupName,
            subgroup.subgroup || 'Все',
            row.subject,
            row.cell.planned ?? '',
            row.cell.scheduled,
            row.cell.done,
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
        <h2 className="text-sm font-semibold text-muted-foreground">
          План-факт по {course} курсу
        </h2>
        <span className="text-xs text-muted-foreground">
          на {today.toLocaleDateString('ru-RU')}
        </span>
        <Button variant="secondary" className="ml-auto h-9" onClick={exportCsv}>
          <Download className="h-4 w-4" />
          CSV
        </Button>
      </div>

      <PlanEditor course={course} subjects={subjects} plan={plan} onPlanChange={onPlanChange} />

      {visibleGroups.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Нет данных. Выберите курс или дождитесь загрузки расписания.
          </CardContent>
        </Card>
      ) : (
        visibleGroups.map((group) => (
          <div key={group.groupId} className="overflow-hidden rounded-lg border border-border bg-card">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border bg-muted/40 px-3 py-2">
              <div>
                <span className="text-base font-bold">{group.groupName}</span>
                {group.department && <span className="ml-2 text-xs text-muted-foreground">{group.department}</span>}
              </div>
            </div>
            {group.subgroups.map((subgroup) => (
              <SubgroupTable
                key={`${group.groupId}-${subgroup.subgroup ?? 'all'}`}
                title={subgroup.subgroup ? `Подгруппа ${subgroup.subgroup}` : 'Группа целиком'}
                rows={subgroup.rows}
              />
            ))}
          </div>
        ))
      )}
    </div>
  )
}

function SubgroupTable({ title, rows }: { title: string; rows: { subject: string; cell: AnalyticsCell }[] }) {
  return (
    <div className="border-t border-border first:border-t-0">
      <div className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </div>
      <div className="overflow-x-auto">
        <table className="dense-table">
          <thead>
            <tr>
              <th className="text-left">Предмет</th>
              <th className="w-20 text-right">План</th>
              <th className="w-24 text-right">В расписании</th>
              <th className="w-24 text-right">Проведено</th>
              <th className="w-24 text-right">Осталось</th>
              <th className="w-32 text-right">Прогресс</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const color = statusColor(row.cell)
              const remaining = row.cell.planned !== null ? row.cell.planned - row.cell.done : null
              const prog = progress(row.cell)
              return (
                <tr key={row.subject}>
                  <td className="font-semibold">{row.subject}</td>
                  <td className="text-right tabular-nums">
                    {row.cell.planned ?? <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className={cn('text-right tabular-nums', toneClass(color))}>{row.cell.scheduled}</td>
                  <td className="text-right tabular-nums">{row.cell.done}</td>
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
                    {row.cell.planned !== null ? (
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
            })}
          </tbody>
        </table>
      </div>
    </div>
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
  return (
    <div className="rounded-lg border border-border bg-card">
      <button
        type="button"
        className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-semibold transition hover:bg-muted/40"
        onClick={() => setOpen((value) => !value)}
      >
        <span>План по предметам ({subjects.length})</span>
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
