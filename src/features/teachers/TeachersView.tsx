import { AlertTriangle, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { DAY_ORDER, PAIRS } from '@/lib/constants'
import {
  buildTeacherSummaries,
  getPairRange,
  getTeacherLessonAt,
  groupLessonsByDay,
  normalizeRoom,
  type TeacherSummary,
} from '@/lib/schedule'
import { cn, normalizeForTeacherSearch, pluralPair } from '@/lib/utils'
import type { ScheduleLesson } from '@/types/schedule'

interface TeachersViewProps {
  lessons: ScheduleLesson[]
}

export function TeachersView({ lessons }: TeachersViewProps) {
  const [query, setQuery] = useState('')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const teachers = useMemo(() => buildTeacherSummaries(lessons), [lessons])

  const filteredTeachers = useMemo(() => {
    const q = normalizeForTeacherSearch(query)
    if (!q) return teachers
    return teachers.filter((teacher) => teacher.searchKey.includes(q))
  }, [teachers, query])

  useEffect(() => {
    if (filteredTeachers.length === 0) {
      setSelectedKey(null)
      return
    }
    if (!selectedKey || !filteredTeachers.find((teacher) => teacher.teacher === selectedKey)) {
      setSelectedKey(filteredTeachers[0].teacher)
    }
  }, [filteredTeachers, selectedKey])

  const selectedTeacher =
    filteredTeachers.find((teacher) => teacher.teacher === selectedKey) || filteredTeachers[0] || null

  return (
    <div className="grid gap-5 xl:grid-cols-teachers">
      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Преподаватели</CardTitle>
          <div className="relative mt-3">
            <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-9"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="ФИО, должность или кабинет"
            />
          </div>
        </CardHeader>
        <CardContent className="max-h-teacher-list space-y-2 overflow-auto">
          {filteredTeachers.length === 0 && (
            <p className="py-4 text-center text-sm text-muted-foreground">Никого не найдено.</p>
          )}
          {filteredTeachers.map((teacher) => {
            const active = teacher.teacher === selectedTeacher?.teacher
            return (
              <button
                key={teacher.teacher}
                type="button"
                onClick={() => setSelectedKey(teacher.teacher)}
                className={cn(
                  'w-full rounded-xl border p-3 text-left transition focus:outline-none focus:ring-2 focus:ring-primary/40',
                  active
                    ? 'border-primary bg-primary/15 text-foreground shadow-sm'
                    : 'border-border bg-background/70 hover:border-primary/40 hover:bg-muted/40',
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className={cn('truncate font-semibold', active && 'text-primary')}>
                      {teacher.teacher}
                    </p>
                    <p className="text-sm text-muted-foreground">{pluralPair(teacher.totalPairs)}</p>
                    {teacher.rooms.length > 0 && (
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        Кабинеты: {teacher.rooms.slice(0, 6).join(', ')}
                        {teacher.rooms.length > 6 ? '…' : ''}
                      </p>
                    )}
                  </div>
                  {teacher.conflicts.length > 0 && (
                    <Badge tone="red">{teacher.conflicts.length} конфликт</Badge>
                  )}
                </div>
              </button>
            )
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{selectedTeacher ? selectedTeacher.teacher : 'Выберите преподавателя'}</CardTitle>
          {selectedTeacher && (
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge tone="blue">{pluralPair(selectedTeacher.totalPairs)}</Badge>
              {selectedTeacher.conflicts.length > 0 && (
                <Badge tone="red">
                  <AlertTriangle className="mr-1 h-3 w-3" />
                  Есть конфликты
                </Badge>
              )}
              {selectedTeacher.rooms.length > 0 && (
                <Badge tone="muted">Кабинеты: {selectedTeacher.rooms.join(', ')}</Badge>
              )}
            </div>
          )}
        </CardHeader>
        <CardContent>
          {selectedTeacher ? (
            <TeacherSchedule summary={selectedTeacher} />
          ) : (
            <p className="text-muted-foreground">Нет данных по преподавателю.</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function TeacherSchedule({ summary }: { summary: TeacherSummary }) {
  const byDay = groupLessonsByDay(summary.lessons)
  const [hover, setHover] = useState<{
    x: number
    y: number
    day: string
    pair: number
    items: ScheduleLesson[]
  } | null>(null)

  return (
    <div className="space-y-5">
      <div
        className="relative grid grid-cols-7 gap-1 rounded-2xl border border-border bg-muted p-2"
        onMouseLeave={() => setHover(null)}
      >
        {DAY_ORDER.map((day) => (
          <div key={day} className="text-center text-xs font-semibold text-muted-foreground">
            {day}
          </div>
        ))}
        {PAIRS.flatMap((pair) =>
          DAY_ORDER.map((day) => {
            const items = getTeacherLessonAt(summary.lessons, day, pair)
            const busy = items.length > 0
            return (
              <div
                key={`${day}-${pair}`}
                className={busy ? 'teacher-busy-cell' : 'teacher-free-cell'}
                onMouseEnter={
                  busy
                    ? (event) =>
                        setHover({
                          x: event.clientX + 12,
                          y: event.clientY + 12,
                          day,
                          pair,
                          items,
                        })
                    : undefined
                }
                onMouseMove={
                  busy
                    ? (event) =>
                        setHover((prev) =>
                          prev && prev.day === day && prev.pair === pair
                            ? { ...prev, x: event.clientX + 12, y: event.clientY + 12 }
                            : { x: event.clientX + 12, y: event.clientY + 12, day, pair, items },
                        )
                    : undefined
                }
                onMouseLeave={busy ? () => setHover(null) : undefined}
              >
                {pair}
              </div>
            )
          }),
        )}
        {hover && <BusyTooltip {...hover} />}
      </div>
      {byDay.map((day) => (
        <div key={day.day}>
          <h3 className="mb-2 text-sm font-semibold text-muted-foreground">{day.day}</h3>
          <div className="space-y-2">
            {day.lessons.map((lesson, index) => (
              <div
                key={`${lesson.day}-${lesson.pair}-${index}`}
                className={cn(
                  'rounded-xl border border-border bg-background/70 p-3',
                  lesson.cancelled && 'border-red-500/40 bg-red-500/10',
                )}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="muted">{getPairRange(lesson)} пара</Badge>
                  <p className={cn('font-semibold', lesson.cancelled && 'text-red-500 line-through')}>
                    {lesson.subject}
                  </p>
                  {lesson.cancelled && (
                    <span className="text-xs font-semibold text-red-500">отменена</span>
                  )}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {lesson.group} · {normalizeRoom(lesson.room) || 'аудитория не указана'} · {lesson.time}
                </p>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function BusyTooltip({
  x,
  y,
  items,
}: {
  x: number
  y: number
  day: string
  pair: number
  items: ScheduleLesson[]
}) {
  const rooms = Array.from(
    new Set(items.map((lesson) => normalizeRoom(lesson.room)).filter(Boolean)),
  )
  const groups = Array.from(new Set(items.map((lesson) => lesson.group)))
  const subjects = Array.from(new Set(items.map((lesson) => lesson.subject)))
  return (
    <div
      className="slot-tooltip pointer-events-none fixed z-50 max-w-xs rounded-lg border border-border px-3 py-2 text-xs shadow-xl"
      style={{ left: x, top: y }}
    >
      <div className="font-bold text-primary">{subjects.join(' · ') || '—'}</div>
      <div className="text-amber-500">Кабинет: {rooms.length > 0 ? rooms.join(', ') : '—'}</div>
      <div className="text-emerald-400">Группы: {groups.length > 0 ? groups.join(', ') : '—'}</div>
    </div>
  )
}
