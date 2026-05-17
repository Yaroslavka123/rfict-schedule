import { ExternalLink } from 'lucide-react'

import { Card, CardContent } from '@/components/ui/card'
import { LESSON_TYPE_LABELS, DAY_ORDER } from '@/lib/constants'
import { buildStats, getGoogleSheetUrl, getGroupNameById, getPairRange } from '@/lib/schedule'
import { cn } from '@/lib/utils'
import type { ScheduleGroup, ScheduleLesson } from '@/types/schedule'

interface ScheduleViewProps {
  groups: ScheduleGroup[]
  lessons: ScheduleLesson[]
  weekName: string
  dateRange: string
}

export function ScheduleView({ groups, lessons, weekName, dateRange }: ScheduleViewProps) {
  const stats = buildStats(lessons)

  const byDay: Record<string, ScheduleLesson[]> = {}
  DAY_ORDER.forEach((day) => (byDay[day] = []))
  lessons.forEach((lesson) => {
    if (!byDay[lesson.day]) byDay[lesson.day] = []
    byDay[lesson.day].push(lesson)
  })
  Object.values(byDay).forEach((list) =>
    list.sort((a, b) => a.pair - b.pair || a.group.localeCompare(b.group, 'ru', { numeric: true })),
  )
  const populatedDays = DAY_ORDER.filter((day) => (byDay[day] || []).length > 0)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Stat label="Занятий" value={stats.total} />
        <Stat label="Лекций" value={stats.lectures} tone="green" />
        <Stat label="Лаб" value={stats.labs} tone="orange" />
        <Stat label="Практик" value={stats.practices} tone="blue" />
        <Stat label="Отмен" value={stats.cancelled} tone="red" />
        <span className="ml-auto text-xs text-muted-foreground">
          {weekName}
          {dateRange ? ` · ${dateRange}` : ''}
        </span>
      </div>

      {lessons.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">По выбранным фильтрам занятий нет.</CardContent>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="dense-table">
            <thead>
              <tr>
                <th className="w-12">Пара</th>
                <th className="w-24">Время</th>
                <th className="w-24">Тип</th>
                <th>Предмет</th>
                <th>Преподаватель</th>
                <th className="w-16">Ауд.</th>
                <th>Группа</th>
                <th>Подгруппа</th>
                <th>Период</th>
                <th>Инфо</th>
              </tr>
            </thead>
            <tbody>
              {populatedDays.map((day) => (
                <DayBlock key={day} day={day} lessons={byDay[day]} groups={groups} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function DayBlock({ day, lessons, groups }: { day: string; lessons: ScheduleLesson[]; groups: ScheduleGroup[] }) {
  return (
    <>
      <tr className="day-header">
        <td colSpan={10}>{day}</td>
      </tr>
      {lessons.map((lesson, index) => (
        <LessonRow key={`${lesson.day}-${lesson.pair}-${lesson.group}-${lesson.subject}-${lesson.subgroup ?? ''}-${index}`} lesson={lesson} groups={groups} />
      ))}
    </>
  )
}

function LessonRow({ lesson, groups }: { lesson: ScheduleLesson; groups: ScheduleGroup[] }) {
  const sheetUrl = getGoogleSheetUrl(lesson)
  const period =
    lesson.period_start && lesson.period_end
      ? `с ${lesson.period_start} по ${lesson.period_end}`
      : lesson.period_end
      ? `по ${lesson.period_end}`
      : lesson.period_start
      ? `с ${lesson.period_start}`
      : lesson.frequency || ''
  const info = [lesson.comment, lesson.frequency && !lesson.subgroup ? lesson.frequency : null].filter(Boolean).join('; ')
  return (
    <tr className={lesson.cancelled ? 'opacity-50' : ''}>
      <td className="font-bold">{getPairRange(lesson)}</td>
      <td className="whitespace-nowrap text-muted-foreground">{lesson.time || '—'}</td>
      <td>
        <span className={cn('type-badge', `type-${lesson.type}`)}>{LESSON_TYPE_LABELS[lesson.type]}</span>
      </td>
      <td className="font-semibold">
        <div className="flex items-center gap-1.5">
          <span className={lesson.cancelled ? 'line-through' : ''}>{lesson.subject}</span>
          {sheetUrl && (
            <a className="inline-flex text-muted-foreground transition hover:text-primary" href={sheetUrl} target="_blank" rel="noreferrer" aria-label="Открыть Google Таблицу">
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
          {lesson.cancelled && <span className="text-red-500 text-xs font-semibold">ОТМЕНА</span>}
        </div>
      </td>
      <td className="text-muted-foreground">{lesson.teacher || '—'}</td>
      <td className="font-semibold text-amber-500">{lesson.room || '—'}</td>
      <td>{getGroupNameById(groups, lesson.group)}</td>
      <td className="text-purple-400 text-xs">{lesson.subgroup || ''}</td>
      <td className="text-xs text-muted-foreground">{period}</td>
      <td className="text-xs text-muted-foreground">{info}</td>
    </tr>
  )
}

function Stat({ label, value, tone = 'default' }: { label: string; value: number; tone?: 'default' | 'green' | 'orange' | 'blue' | 'red' }) {
  const toneClass = {
    default: 'text-primary',
    green: 'text-emerald-500',
    orange: 'text-amber-500',
    blue: 'text-sky-500',
    red: 'text-red-500',
  }[tone]
  return (
    <div className="flex items-baseline gap-2 rounded-md border border-border bg-card px-3 py-1.5">
      <span className={cn('text-lg font-bold tabular-nums', toneClass)}>{value}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  )
}
