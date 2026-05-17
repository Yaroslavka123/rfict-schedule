import { AlertTriangle, Search } from 'lucide-react'
import { useMemo, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { DAY_ORDER, PAIRS } from '@/lib/constants'
import { buildTeacherSummaries, getBusyPairsForTeacher, getPairRange, groupLessonsByDay } from '@/lib/schedule'
import { normalizeText, pluralPair } from '@/lib/utils'
import type { ScheduleLesson } from '@/types/schedule'

interface TeachersViewProps {
  lessons: ScheduleLesson[]
}

export function TeachersView({ lessons }: TeachersViewProps) {
  const [query, setQuery] = useState('')
  const teachers = useMemo(() => buildTeacherSummaries(lessons), [lessons])
  const filteredTeachers = teachers.filter((teacher) => normalizeText(teacher.teacher).includes(normalizeText(query)))
  const selectedTeacher = filteredTeachers[0] || null

  return (
    <div className="grid gap-5 xl:grid-cols-teachers">
      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Преподаватели</CardTitle>
          <div className="relative mt-3">
            <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Найти преподавателя" />
          </div>
        </CardHeader>
        <CardContent className="max-h-teacher-list space-y-2 overflow-auto">
          {filteredTeachers.map((teacher) => (
            <div key={teacher.teacher} className="rounded-xl border border-border bg-background/70 p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">{teacher.teacher}</p>
                  <p className="text-sm text-muted-foreground">{pluralPair(teacher.totalPairs)}</p>
                </div>
                {teacher.conflicts.length > 0 && <Badge tone="red">{teacher.conflicts.length} конфликт</Badge>}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{selectedTeacher ? selectedTeacher.teacher : 'Выберите преподавателя'}</CardTitle>
          {selectedTeacher && (
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge tone="blue">{pluralPair(selectedTeacher.totalPairs)}</Badge>
              {selectedTeacher.conflicts.length > 0 && <Badge tone="red"><AlertTriangle className="mr-1 h-3 w-3" />Есть конфликты</Badge>}
            </div>
          )}
        </CardHeader>
        <CardContent>
          {selectedTeacher ? <TeacherSchedule lessons={selectedTeacher.lessons} /> : <p className="text-muted-foreground">Нет данных по преподавателю.</p>}
        </CardContent>
      </Card>
    </div>
  )
}

function TeacherSchedule({ lessons }: { lessons: ScheduleLesson[] }) {
  const byDay = groupLessonsByDay(lessons)
  const busyPairs = getBusyPairsForTeacher(lessons)

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-7 gap-1 rounded-2xl border border-border bg-muted p-2">
        {DAY_ORDER.map((day) => <div key={day} className="text-center text-xs font-semibold text-muted-foreground">{day}</div>)}
        {PAIRS.flatMap((pair) => DAY_ORDER.map((day) => {
          const busy = busyPairs.find((item) => item.day === day && item.pair === pair)?.busy
          return <div key={`${day}-${pair}`} className={busy ? 'teacher-busy-cell' : 'teacher-free-cell'}>{pair}</div>
        }))}
      </div>
      {byDay.map((day) => (
        <div key={day.day}>
          <h3 className="mb-2 text-sm font-semibold text-muted-foreground">{day.day}</h3>
          <div className="space-y-2">
            {day.lessons.map((lesson, index) => (
              <div key={`${lesson.day}-${lesson.pair}-${index}`} className="rounded-xl border border-border bg-background/70 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="muted">{getPairRange(lesson)} пара</Badge>
                  <p className="font-semibold">{lesson.subject}</p>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{lesson.group} · {lesson.room || 'аудитория не указана'} · {lesson.time}</p>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
