import { useEffect, useMemo, useRef, useState } from 'react'

import { Card, CardContent } from '@/components/ui/card'
import { LESSON_TYPE_LABELS, PAIRS, PAIR_TIMES } from '@/lib/constants'
import { normalizeRoom, normalizeTeacherName } from '@/lib/schedule'
import { cn } from '@/lib/utils'
import type { LessonType, ScheduleLesson } from '@/types/schedule'

interface TeachersViewProps {
  lessons: ScheduleLesson[]
}

interface TeacherSlot {
  subject: string
  group: string
  room: string
  type: LessonType
  subgroup: string
  time: string
  pair: number
  cancelled: boolean
  course?: number
}

const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']

/**
 * Teacher matrix view — same shape as the rooms matrix, but the columns are
 * teachers and the cells show which room(s) the teacher is in for that
 * day/pair. The hover tooltip exposes full lesson details.
 */
export function TeachersView({ lessons }: TeachersViewProps) {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; entries: TeacherSlot[]; teacher: string } | null>(
    null,
  )

  const { occupancy, orderedTeachers } = useMemo(() => buildTeacherOccupancy(lessons), [lessons])

  const wrapRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const calc = () => {
      const cols = orderedTeachers.length
      if (cols === 0) return
      const gutters = 64
      const usable = el.clientWidth - gutters
      const target = Math.max(36, Math.min(80, usable / cols))
      el.style.setProperty('--room-cell-size', `${target}px`)
      el.style.setProperty('--room-cell-min', `${Math.max(36, target - 8)}px`)
      el.style.setProperty('--room-cell-max', `${target + 18}px`)
    }
    calc()
    const obs = new ResizeObserver(calc)
    obs.observe(el)
    window.addEventListener('resize', calc)
    return () => {
      obs.disconnect()
      window.removeEventListener('resize', calc)
    }
  }, [orderedTeachers.length])

  if (orderedTeachers.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          По текущим фильтрам преподаватели не найдены.
        </CardContent>
      </Card>
    )
  }

  const showTooltip = (
    event: React.MouseEvent<HTMLTableCellElement>,
    entries: TeacherSlot[],
    teacher: string,
  ) => {
    setTooltip({ x: event.clientX + 12, y: event.clientY + 12, entries, teacher })
  }

  const hideTooltip = () => setTooltip(null)

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-muted-foreground">Преподаватели</h2>
        <span className="text-xs text-muted-foreground">
          {orderedTeachers.length} {plural(orderedTeachers.length, 'преподаватель', 'преподавателя', 'преподавателей')}
        </span>
      </div>

      <div className="room-matrix-wrap" ref={wrapRef}>
        <table className="room-matrix" onMouseLeave={hideTooltip}>
          <thead>
            <tr>
              <th className="th-day">Д</th>
              <th className="th-pair">П</th>
              {orderedTeachers.map((teacher) => (
                <th
                  key={teacher}
                  className="th-room text-[10px] text-foreground/80"
                  title={teacher}
                >
                  {shortenTeacher(teacher)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {DAYS.map((day, dayIndex) =>
              PAIRS.map((pair) => (
                <tr key={`${day}-${pair}`} className={pair === 1 && dayIndex > 0 ? 'day-separator' : ''}>
                  {pair === 1 && (
                    <td className="td-day" rowSpan={8}>
                      {day}
                    </td>
                  )}
                  <td className="td-pair" title={PAIR_TIMES[pair]}>
                    {pair}
                  </td>
                  {orderedTeachers.map((teacher) => {
                    const entries = occupancy[teacher]?.[day]?.[pair] || []
                    if (entries.length === 0) {
                      return <td key={teacher} className="slot-cell slot-free" />
                    }
                    const allCancelled = entries.every((entry) => entry.cancelled)
                    const types = Array.from(new Set(entries.map((e) => e.type)))
                    const typeClass = allCancelled
                      ? 'slot-cancelled'
                      : types.length > 1
                      ? 'slot-type-multi'
                      : `slot-type-${types[0] || 'unknown'}`
                    const rooms = Array.from(new Set(entries.map((e) => e.room).filter(Boolean)))
                    return (
                      <td
                        key={teacher}
                        className={cn('slot-cell slot-busy', typeClass)}
                        onMouseEnter={(event) => showTooltip(event, entries, teacher)}
                        onMouseMove={(event) => showTooltip(event, entries, teacher)}
                        onMouseLeave={hideTooltip}
                      >
                        <div className="slot-content">
                          <div className={cn('slot-main', allCancelled && 'line-through')}>
                            {rooms[0] || '—'}
                          </div>
                          {rooms.length > 1 && <div className="slot-meta">+{rooms.length - 1}</div>}
                        </div>
                        {rooms.length > 1 && (
                          <span className="slot-badge slot-badge-group" title={`Кабинетов: ${rooms.length}`}>
                            {rooms.length}
                          </span>
                        )}
                      </td>
                    )
                  })}
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>

      {tooltip && <TeacherTooltip x={tooltip.x} y={tooltip.y} entries={tooltip.entries} teacher={tooltip.teacher} />}
    </div>
  )
}

function TeacherTooltip({
  x,
  y,
  entries,
  teacher,
}: {
  x: number
  y: number
  entries: TeacherSlot[]
  teacher: string
}) {
  return (
    <div
      className="slot-tooltip pointer-events-none fixed z-50 max-w-xs rounded-lg border border-border px-3 py-2 text-xs shadow-xl"
      style={{ left: x, top: y }}
    >
      <div className="mb-1 font-bold text-primary">{teacher}</div>
      {entries.map((entry, idx) => (
        <div key={idx}>
          {idx > 0 && <hr className="my-1.5 border-border" />}
          <div className={cn('font-bold', entry.cancelled ? 'text-red-500 line-through' : 'text-foreground')}>
            {entry.subject || '—'}
          </div>
          <div className="text-amber-500">Кабинет: {entry.room || '—'}</div>
          <div className="text-emerald-400">
            Группа: {entry.group}
            {entry.subgroup ? ` ${formatSubgroup(entry.subgroup)}` : ''}
          </div>
          {entry.course !== undefined && (
            <div className="text-sky-400">{entry.course} курс</div>
          )}
          <div className="text-purple-400">{LESSON_TYPE_LABELS[entry.type] || entry.type}</div>
          <div className="text-muted-foreground">{entry.time}</div>
          {entry.cancelled && <div className="font-semibold text-red-500">Пара отменена</div>}
        </div>
      ))}
    </div>
  )
}

function formatSubgroup(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  if (/\d/.test(trimmed)) return `${trimmed.replace(/\s+/g, '')} пг`
  return trimmed
}

function shortenTeacher(teacher: string): string {
  const parts = teacher.trim().split(/\s+/)
  if (parts.length >= 2) {
    const initials = parts.slice(1).map((p) => `${p[0]}.`).join('')
    return `${parts[0]} ${initials}`.trim()
  }
  return teacher
}

function plural(value: number, one: string, few: string, many: string) {
  const abs = Math.abs(value)
  const mod10 = abs % 10
  const mod100 = abs % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}

function buildTeacherOccupancy(lessons: ScheduleLesson[]) {
  const occupancy: Record<string, Record<string, Record<number, TeacherSlot[]>>> = {}
  lessons.forEach((lesson) => {
    const teacher = normalizeTeacherName(lesson.teacher)
    if (!teacher) return
    if (!occupancy[teacher]) occupancy[teacher] = {}
    const day = lesson.day
    if (!occupancy[teacher][day]) occupancy[teacher][day] = {}
    const duration = Math.max(lesson.duration || 1, 1)
    for (let p = lesson.pair; p < lesson.pair + duration; p += 1) {
      if (!occupancy[teacher][day][p]) occupancy[teacher][day][p] = []
      occupancy[teacher][day][p].push({
        subject: lesson.subject || '',
        group: lesson.group,
        room: normalizeRoom(lesson.room),
        type: lesson.type,
        subgroup: lesson.subgroup || '',
        time: PAIR_TIMES[p] || '',
        pair: p,
        cancelled: Boolean(lesson.cancelled),
        course: lesson.course_number,
      })
    }
  })

  const orderedTeachers = Object.keys(occupancy).sort((a, b) =>
    a.localeCompare(b, 'ru', { numeric: true }),
  )
  return { occupancy, orderedTeachers }
}


