import { ExternalLink, Info, Link2 } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { LESSON_TYPE_TONES } from '@/lib/constants'
import { buildStats, getGoogleSheetUrl, getGroupName, getPairRange, groupLessonsByDay } from '@/lib/schedule'
import { pluralPair } from '@/lib/utils'
import type { ScheduleLesson, WeekSchedule } from '@/types/schedule'

interface ScheduleViewProps {
  schedule: WeekSchedule
  lessons: ScheduleLesson[]
}

export function ScheduleView({ schedule, lessons }: ScheduleViewProps) {
  const stats = buildStats(lessons)
  const byDay = groupLessonsByDay(lessons)

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Stat label="Всего" value={String(stats.total)} />
        <Stat label="Активных" value={String(stats.active)} />
        <Stat label="Лекций" value={String(stats.lectures)} />
        <Stat label="Лабораторных" value={String(stats.labs)} />
        <Stat label="Отмен" value={String(stats.cancelled)} danger />
      </div>
      {byDay.length === 0 ? (
        <EmptySchedule />
      ) : (
        byDay.map((day) => (
          <Card key={day.day} className="overflow-hidden">
            <CardHeader className="sticky top-20 z-20 flex-row items-center justify-between bg-card/95 backdrop-blur">
              <CardTitle>{day.day}</CardTitle>
              <Badge tone="muted">{pluralPair(day.lessons.reduce((sum, lesson) => sum + lesson.duration, 0))}</Badge>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="schedule-table">
                  <thead>
                    <tr>
                      <th>Пара</th>
                      <th>Время</th>
                      <th>Тип</th>
                      <th>Предмет</th>
                      <th>Преподаватель</th>
                      <th>Аудитория</th>
                      <th>Группа</th>
                      <th>Период</th>
                      <th>Инфо</th>
                    </tr>
                  </thead>
                  <tbody>
                    {day.lessons.map((lesson, index) => (
                      <LessonRow key={`${lesson.day}-${lesson.pair}-${lesson.group}-${lesson.subject}-${index}`} lesson={lesson} schedule={schedule} />
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  )
}

function Stat({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{label}</p>
        <p className={danger ? 'mt-2 text-3xl font-bold text-destructive' : 'mt-2 text-3xl font-bold'}>{value}</p>
      </CardContent>
    </Card>
  )
}

function LessonRow({ lesson, schedule }: { lesson: ScheduleLesson; schedule: WeekSchedule }) {
  const sheetUrl = getGoogleSheetUrl(lesson)
  return (
    <tr className={lesson.cancelled ? 'opacity-60' : ''}>
      <td className="font-bold">{getPairRange(lesson)}</td>
      <td>{lesson.time}</td>
      <td><Badge tone={LESSON_TYPE_TONES[lesson.type]}>{lesson.type}</Badge></td>
      <td>
        <div className={lesson.cancelled ? 'line-through' : ''}>
          <div className="flex items-center gap-2 font-semibold">
            {lesson.subject}
            {sheetUrl ? (
              <a className="inline-link" href={sheetUrl} target="_blank" rel="noreferrer" aria-label="Открыть Google Таблицу">
                <ExternalLink className="h-4 w-4" />
              </a>
            ) : (
              <span className="text-muted-foreground" title="google_sheet_id пока не пришёл из parser"><Link2 className="h-4 w-4" /></span>
            )}
          </div>
          {lesson.cancelled && <Badge tone="red" className="mt-2">ОТМЕНА</Badge>}
        </div>
      </td>
      <td>{lesson.teacher || '—'}</td>
      <td>{lesson.room || '—'}</td>
      <td>{getGroupName(schedule, lesson.group)}{lesson.subgroup ? ` · ${lesson.subgroup}` : ''}</td>
      <td>{[lesson.period_start, lesson.period_end].filter(Boolean).join(' — ') || lesson.frequency || '—'}</td>
      <td>
        {lesson.comment ? <span className="inline-flex items-center gap-1 text-sm text-muted-foreground"><Info className="h-4 w-4" />{lesson.comment}</span> : '—'}
      </td>
    </tr>
  )
}

function EmptySchedule() {
  return (
    <Card>
      <CardContent className="py-12 text-center text-muted-foreground">По выбранным фильтрам занятий нет.</CardContent>
    </Card>
  )
}
