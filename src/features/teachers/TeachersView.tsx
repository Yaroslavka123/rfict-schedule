import { useMemo, useState } from 'react'

import { Card, CardContent } from '@/components/ui/card'
import { LESSON_TYPE_LABELS, PAIRS, PAIR_TIMES } from '@/lib/constants'
import { getGroupNameById, normalizeRoom, normalizeTeacherName } from '@/lib/schedule'
import { normalizeText } from '@/lib/utils'
import { cn } from '@/lib/utils'
import type {
  LessonType,
  ScheduleGroup,
  ScheduleGroupWithCourse,
  ScheduleLesson,
} from '@/types/schedule'

interface TeachersViewProps {
  lessons: ScheduleLesson[]
  groups: (ScheduleGroup | ScheduleGroupWithCourse)[]
  search: string
  lessonTypes: LessonType[]
}

interface TeacherSlot {
  subject: string
  group: string
  groupId: string
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
 * Teacher matrix — days/pairs on the left, teachers on top, room codes inside
 * cells. The full lesson set is computed once and stays cached; the search
 * input highlights matching teacher columns instead of re-filtering.
 */
export function TeachersView({ lessons, groups, search, lessonTypes }: TeachersViewProps) {
  const [tooltip, setTooltip] = useState<{
    x: number
    y: number
    entries: TeacherSlot[]
    teacher: string
  } | null>(null)

  const { occupancy, orderedTeachers } = useMemo(
    () => buildTeacherOccupancy(lessons, groups),
    [lessons, groups],
  )

  const normalizedSearch = useMemo(() => normalizeText(search.trim()), [search])
  const teacherMatch = useMemo(() => {
    if (!normalizedSearch) return null
    const set = new Set<string>()
    orderedTeachers.forEach((teacher) => {
      if (normalizeText(teacher).includes(normalizedSearch)) set.add(teacher)
    })
    return set
  }, [orderedTeachers, normalizedSearch])

  const showTooltip = (
    event: React.MouseEvent<HTMLTableCellElement>,
    entries: TeacherSlot[],
    teacher: string,
  ) => setTooltip({ x: event.clientX + 8, y: event.clientY + 8, entries, teacher })
  const hideTooltip = () => setTooltip(null)

  if (orderedTeachers.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">Преподаватели не найдены.</CardContent>
      </Card>
    )
  }

  return (
    <div className="teachers-page">
      <div className="teachers-matrix-wrap">
        <table className="teachers-matrix" onMouseLeave={hideTooltip}>
          <colgroup>
            <col style={{ width: '2rem' }} />
            <col style={{ width: '2rem' }} />
            {orderedTeachers.map((teacher) => (
              <col key={teacher} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th className="th-day">Д</th>
              <th className="th-pair">П</th>
              {orderedTeachers.map((teacher) => {
                const isMatch = teacherMatch?.has(teacher)
                const isDim = teacherMatch && !isMatch
                return (
                  <th
                    key={teacher}
                    className={cn('th-teacher', isMatch && 'th-teacher-match', isDim && 'th-teacher-dim')}
                    title={teacher}
                  >
                    <div className="th-teacher-label">{shortTeacherName(teacher)}</div>
                  </th>
                )
              })}
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
                    const filtered =
                      lessonTypes.length > 0
                        ? entries.filter((e) => lessonTypes.includes(e.type))
                        : entries
                    const isMatch = teacherMatch?.has(teacher)
                    const isDim = teacherMatch && !isMatch
                    if (filtered.length === 0) {
                      return (
                        <td
                          key={teacher}
                          className={cn('slot-cell slot-free', isDim && 'slot-dim')}
                        />
                      )
                    }
                    const allCancelled = filtered.every((entry) => entry.cancelled)
                    const types = Array.from(new Set(filtered.map((e) => e.type)))
                    const typeClass = allCancelled
                      ? 'slot-cancelled'
                      : types.length > 1
                      ? 'slot-type-multi'
                      : `slot-type-${types[0] || 'unknown'}`
                    const rooms = Array.from(new Set(filtered.map((entry) => entry.room).filter(Boolean)))
                    return (
                      <td
                        key={teacher}
                        className={cn(
                          'slot-cell slot-busy',
                          typeClass,
                          isMatch && 'slot-match',
                          isDim && 'slot-dim',
                        )}
                        onMouseEnter={(event) => showTooltip(event, filtered, teacher)}
                        onMouseMove={(event) => showTooltip(event, filtered, teacher)}
                        onMouseLeave={hideTooltip}
                      >
                        <div className={cn('slot-content', allCancelled && 'line-through')}>
                          <div className="slot-main">{rooms[0] || '—'}</div>
                          {rooms.length > 1 && (
                            <span className="slot-badge slot-badge-group" title={`Кабинетов: ${rooms.length}`}>
                              {rooms.length}
                            </span>
                          )}
                        </div>
                      </td>
                    )
                  })}
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>

      {tooltip && (
        <TeacherTooltip x={tooltip.x} y={tooltip.y} entries={tooltip.entries} teacher={tooltip.teacher} />
      )}
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
      <div className="mb-1 font-bold text-primary">{teacher || '—'}</div>
      {entries.map((entry, idx) => (
        <div key={idx}>
          {idx > 0 && <hr className="my-1.5 border-border" />}
          <div className={cn('font-semibold', entry.cancelled ? 'text-red-500 line-through' : 'text-amber-400')}>
            {entry.subject || '—'}
          </div>
          <div className="text-emerald-400">
            Кабинет: {entry.room || '—'}
          </div>
          <div className="text-emerald-400">
            {entry.group || '—'}
            {entry.subgroup ? ` · ${formatSubgroup(entry.subgroup)}` : ''}
            {entry.course ? ` · ${entry.course} курс` : ''}
          </div>
          {entry.type && (
            <div className="text-purple-400">{LESSON_TYPE_LABELS[entry.type as LessonType] || entry.type}</div>
          )}
          {entry.time && <div className="text-muted-foreground">{entry.time}</div>}
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

function shortTeacherName(full: string): string {
  // "Иванов И. И." → keep as-is (short); if longer, drop spaces around initials.
  const trimmed = full.trim()
  if (trimmed.length <= 22) return trimmed
  return trimmed.slice(0, 21) + '…'
}

function buildTeacherOccupancy(
  lessons: ScheduleLesson[],
  groups: (ScheduleGroup | ScheduleGroupWithCourse)[],
) {
  const occupancy: Record<string, Record<string, Record<number, TeacherSlot[]>>> = {}
  const groupsById = new Map<string, ScheduleGroupWithCourse>()
  groups.forEach((g) => groupsById.set(g.id, g as ScheduleGroupWithCourse))

  lessons.forEach((lesson) => {
    const teacher = normalizeTeacherName(lesson.teacher || '')
    if (!teacher) return
    if (!occupancy[teacher]) occupancy[teacher] = {}
    const day = lesson.day
    if (!occupancy[teacher][day]) occupancy[teacher][day] = {}
    const duration = Math.max(lesson.duration || 1, 1)
    const courseNumber = lesson.course_number ?? groupsById.get(lesson.group)?.course
    const groupName = getGroupNameById(groups, lesson.group)
    for (let p = lesson.pair; p < lesson.pair + duration; p += 1) {
      if (!occupancy[teacher][day][p]) occupancy[teacher][day][p] = []
      occupancy[teacher][day][p].push({
        subject: lesson.subject || '',
        group: groupName,
        groupId: lesson.group,
        room: normalizeRoom(lesson.room) || '',
        type: lesson.type,
        subgroup: lesson.subgroup || '',
        time: PAIR_TIMES[p] || '',
        pair: p,
        cancelled: Boolean(lesson.cancelled),
        course: courseNumber,
      })
    }
  })
  const orderedTeachers = Object.keys(occupancy).sort((a, b) => a.localeCompare(b, 'ru'))
  return { occupancy, orderedTeachers }
}
