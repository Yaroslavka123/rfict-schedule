import { Download, ExternalLink } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { LESSON_TYPE_TONES } from '@/lib/constants'
import { buildAnalyticsChart, buildPlanFact } from '@/lib/schedule'
import type { WeekSchedule } from '@/types/schedule'

interface AnalyticsViewProps {
  schedule: WeekSchedule
}

export function AnalyticsView({ schedule }: AnalyticsViewProps) {
  const planFact = buildPlanFact(schedule)
  const chartData = buildAnalyticsChart(planFact)

  const exportCsv = () => {
    const header = ['Курс', 'Группа', 'Подгруппа', 'Предмет', 'Тип', 'Преподаватель', 'GoogleSheetId', 'План', 'Факт', 'Осталось']
    const rows = planFact.map((entry) => [
      entry.course,
      entry.group,
      entry.subgroup || '',
      entry.subject,
      entry.type,
      entry.teacher || '',
      entry.google_sheet_id || '',
      entry.planned_pairs ?? '',
      entry.fact_pairs,
      entry.remaining_pairs ?? '',
    ])
    const csv = [header, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(';'))
      .join('\n')
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `plan-fact-course-${schedule.course}-week-${schedule.week_number}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-5 xl:grid-cols-analytics">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>План-факт</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">UI готов к API `/api/plan` и `/api/analytics/plan-fact`</p>
            </div>
            <Button variant="secondary" onClick={exportCsv}><Download className="h-4 w-4" />CSV для Excel</Button>
          </CardHeader>
          <CardContent>
            <div className="h-chart">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.12} />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip contentStyle={{ borderRadius: 14 }} />
                  <Bar dataKey="fact" name="Факт" fill="#0ea5e9" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="plan" name="План" fill="#8b5cf6" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Что нужно backend-команде</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>Frontend уже ждёт `google_sheet_id` в каждом lesson и умеет работать с backend-first API.</p>
            <ul className="list-disc space-y-2 pl-5">
              <li>`GET /api/v1/schedule?course=&week=` с контрактом WeekSchedule.</li>
              <li>`GET /api/plan` и `PUT /api/plan` для плановых пар.</li>
              <li>`GET /api/analytics/plan-fact` для серверных агрегатов.</li>
              <li>`/ws/updates` или polling endpoint для статуса обновления.</li>
            </ul>
          </CardContent>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Реестр учебных позиций</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="schedule-table">
              <thead>
                <tr>
                  <th>Группа</th>
                  <th>Предмет</th>
                  <th>Тип</th>
                  <th>Преподаватель</th>
                  <th>Google Sheet</th>
                  <th>План</th>
                  <th>Факт</th>
                  <th>Осталось</th>
                </tr>
              </thead>
              <tbody>
                {planFact.map((entry) => (
                  <tr key={entry.key}>
                    <td>{entry.group}{entry.subgroup ? ` · ${entry.subgroup}` : ''}</td>
                    <td className="font-semibold">{entry.subject}</td>
                    <td><Badge tone={LESSON_TYPE_TONES[entry.type]}>{entry.type}</Badge></td>
                    <td>{entry.teacher || '—'}</td>
                    <td>{entry.google_sheet_id ? <a className="inline-link" href={`https://docs.google.com/spreadsheets/d/${entry.google_sheet_id}/edit`} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" />Открыть</a> : 'ожидаем parser'}</td>
                    <td><span className="plan-placeholder">из API</span></td>
                    <td>{entry.fact_pairs}</td>
                    <td>{entry.remaining_pairs ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
