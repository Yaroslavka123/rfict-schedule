import { useEffect, useMemo, useRef, useState } from 'react'

import { Card, CardContent } from '@/components/ui/card'
import { LESSON_TYPE_LABELS, PAIRS, PAIR_TIMES } from '@/lib/constants'
import { categorizeRoom, getGroupNameById, normalizeRoom } from '@/lib/schedule'
import { normalizeText } from '@/lib/utils'
import { cn } from '@/lib/utils'
import type {
  LessonType,
  ScheduleGroup,
  ScheduleGroupWithCourse,
  WeekSchedule,
} from '@/types/schedule'

interface RoomsViewProps {
  weeks: WeekSchedule[]
  groups: (ScheduleGroup | ScheduleGroupWithCourse)[]
  selectedWeek: number
  onWeekChange: (week: number) => void
  search: string
  lessonTypes: LessonType[]
}

interface SlotEntry {
  subject: string
  teacher: string
  group: string
  groupId: string
  course?: number
  type: LessonType
  subgroup: string
  time: string
  pair: number
  cancelled: boolean
  room: string
}

const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']

type Category = 'lecture-hall' | 'computer' | 'regular'

export function RoomsView({
  weeks,
  groups,
  selectedWeek,
  onWeekChange,
  search,
  lessonTypes,
}: RoomsViewProps) {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; entries: SlotEntry[] } | null>(null)

  const activeWeeks = useMemo(() => {
    if (!weeks.length) return [] as WeekSchedule[]
    const target = weeks.filter((week) => week.week_number === selectedWeek)
    if (target.length > 0) return target
    return [weeks[weeks.length - 1]]
  }, [weeks, selectedWeek])

  const { occupancy, orderedRooms, categoryStart, categoryByRoom } = useMemo(
    () => buildOccupancy(activeWeeks, groups, search, lessonTypes),
    [activeWeeks, groups, search, lessonTypes],
  )

  const wrapRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const calc = () => {
      const cols = orderedRooms.length
      if (cols === 0) return
      const gutters = 64
      const usable = el.clientWidth - gutters
      const target = Math.max(28, Math.min(72, usable / cols))
      const usableH = el.clientHeight - 32
      const rows = DAYS.length * PAIRS.length
      const targetH = Math.max(20, Math.min(40, usableH / rows))
      const finalSize = Math.max(target, targetH)
      el.style.setProperty('--room-cell-size', `${finalSize}px`)
      el.style.setProperty('--room-cell-min', `${Math.max(28, finalSize - 8)}px`)
      el.style.setProperty('--room-cell-max', `${finalSize + 18}px`)
    }
    calc()
    const obs = new ResizeObserver(calc)
    obs.observe(el)
    window.addEventListener('resize', calc)
    return () => {
      obs.disconnect()
      window.removeEventListener('resize', calc)
    }
  }, [orderedRooms.length])

  if (!activeWeeks.length) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">Нет данных за выбранный курс.</CardContent>
      </Card>
    )
  }

  if (orderedRooms.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          {search ? 'По запросу ничего не найдено.' : 'Кабинеты не найдены.'}
        </CardContent>
      </Card>
    )
  }

  const showTooltip = (event: React.MouseEvent<HTMLTableCellElement>, entries: SlotEntry[]) => {
    setTooltip({ x: event.clientX + 12, y: event.clientY + 12, entries })
  }

  const hideTooltip = () => setTooltip(null)

  const availableWeeks = Array.from(new Set(weeks.map((w) => w.week_number))).sort((a, b) => a - b)

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Неделя</div>
        <div className="flex flex-wrap gap-1">
          {availableWeeks.map((week) => (
            <button
              key={week}
              type="button"
              className={cn(
                'rounded-md border px-2.5 py-1 text-xs font-semibold transition-all duration-200 ease-out hover:scale-105',
                week === selectedWeek
                  ? 'border-primary bg-primary/15 text-primary'
                  : 'border-border bg-background text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground',
              )}
              onClick={() => onWeekChange(week)}
            >
              {week}-я
            </button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
          <Legend dotClass="bg-amber-500">Поточные</Legend>
          <Legend dotClass="bg-sky-500">Комп. классы</Legend>
          <Legend dotClass="bg-emerald-500">Кабинеты</Legend>
          <span className="w-px h-3 bg-border" />
          <TypeLegend />
        </div>
      </div>

      <div className="room-matrix-wrap" ref={wrapRef}>
        <table className="room-matrix" onMouseLeave={hideTooltip}>
          <thead>
            <tr>
              <th className="th-day">Д</th>
              <th className="th-pair">П</th>
              {orderedRooms.map((room) => {
                const cat = categoryByRoom[room]
                const start = categoryStart[room]
                return (
                  <th
                    key={room}
                    className={cn('th-room', `th-cat-${cat}`, `cat-bg-${cat}`, start && 'room-cat-start')}
                    title={room}
                  >
                    {room}
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
                  {orderedRooms.map((room) => {
                    const entries = occupancy[room]?.[day]?.[pair] || []
                    const cat = categoryByRoom[room]
                    const start = categoryStart[room]
                    if (entries.length === 0) {
                      return (
                        <td
                          key={room}
                          className={cn('slot-cell slot-free', `cat-bg-${cat}`, start && 'room-cat-start')}
                        />
                      )
                    }
                    const allCancelled = entries.every((entry) => entry.cancelled)
                    const types = Array.from(new Set(entries.map((e) => e.type)))
                    const typeClass = allCancelled
                      ? 'slot-cancelled'
                      : types.length > 1
                      ? 'slot-type-multi'
                      : `slot-type-${types[0] || 'unknown'}`
                    const first = entries[0]
                    const groupSet = Array.from(new Set(entries.map((entry) => entry.group).filter(Boolean)))
                    const teacherSet = Array.from(
                      new Set(entries.map((entry) => entry.teacher).filter(Boolean)),
                    )
                    const meta = groupSet.length > 0 ? groupSet.join(', ') : first.teacher
                    return (
                      <td
                        key={room}
                        className={cn(
                          'slot-cell slot-busy',
                          typeClass,
                          `cat-bg-${cat}`,
                          start && 'room-cat-start',
                        )}
                        onMouseEnter={(event) => showTooltip(event, entries)}
                        onMouseMove={(event) => showTooltip(event, entries)}
                        onMouseLeave={hideTooltip}
                      >
                        <div className="slot-content">
                          <div className={cn('slot-main', allCancelled && 'line-through')}>
                            {shortenSubject(first.subject)}
                          </div>
                          {meta && <div className="slot-meta">{meta}</div>}
                        </div>
                        {teacherSet.length > 1 && (
                          <span
                            className="slot-badge slot-badge-teacher"
                            title={`Преподавателей: ${teacherSet.length}`}
                          >
                            {teacherSet.length}
                          </span>
                        )}
                        {groupSet.length > 1 && (
                          <span className="slot-badge slot-badge-group" title={`Групп: ${groupSet.length}`}>
                            {groupSet.length}
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

      {tooltip && <RoomTooltip x={tooltip.x} y={tooltip.y} entries={tooltip.entries} />}
    </div>
  )
}

function Legend({ children, dotClass }: { children: React.ReactNode; dotClass: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-card/40 px-1.5 py-0.5">
      <span className={cn('h-1.5 w-1.5 rounded-full', dotClass)} />
      {children}
    </span>
  )
}

function TypeLegend() {
  const items: Array<{ type: LessonType; label: string }> = [
    { type: 'lecture', label: 'Лек' },
    { type: 'lab', label: 'Лаб' },
    { type: 'practice', label: 'Пр' },
    { type: 'seminar', label: 'Сем' },
    { type: 'curator_hour', label: 'Кур' },
  ]
  return (
    <>
      {items.map(({ type, label }) => (
        <span
          key={type}
          className={cn(
            'inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider',
            `slot-type-${type}`,
          )}
        >
          {label}
        </span>
      ))}
    </>
  )
}

interface TooltipPerSubject {
  subject: string
  teacher: string
  teacherCourses: number[]
  type: string
  subgroup: string
  time: string
  groups: { name: string; subgroup: string | null; course?: number }[]
  cancelled: boolean
}

function RoomTooltip({ x, y, entries }: { x: number; y: number; entries: SlotEntry[] }) {
  const merged = mergeTooltipEntries(entries)
  const room = entries[0]?.room
  return (
    <div
      className="slot-tooltip pointer-events-none fixed z-50 max-w-xs rounded-lg border border-border px-3 py-2 text-xs shadow-xl"
      style={{ left: x, top: y }}
    >
      {room && <div className="mb-1 font-bold text-amber-500">Кабинет: {room}</div>}
      {merged.map((entry, idx) => (
        <div key={`${entry.subject}-${idx}`}>
          {idx > 0 && <hr className="my-1.5 border-border" />}
          <div className={cn('font-bold', entry.cancelled ? 'text-red-500 line-through' : 'text-primary')}>
            {entry.subject || '—'}
          </div>
          <div className="text-muted-foreground">
            {entry.teacher || '—'}
            {entry.teacherCourses.length > 0 && (
              <span className="ml-1 text-amber-400">
                · {entry.teacherCourses.map((c) => `${c} курс`).join(', ')}
              </span>
            )}
          </div>
          <div className="text-emerald-400">
            {entry.groups.length > 0 ? (
              entry.groups.map((g, i) => (
                <div key={i}>
                  {g.name}
                  {g.subgroup ? ` ${formatSubgroup(g.subgroup)}` : ''}
                </div>
              ))
            ) : (
              '—'
            )}
          </div>
          {entry.type && (
            <div className="text-purple-400">
              {LESSON_TYPE_LABELS[entry.type as LessonType] || entry.type}
            </div>
          )}
          {entry.time && <div className="text-muted-foreground">{entry.time}</div>}
          {entry.cancelled && <div className="font-semibold text-red-500">Пара отменена</div>}
        </div>
      ))}
    </div>
  )
}

/**
 * Formats a subgroup token like '3' or '3/4' into the user-requested form:
 *   '3 пг' for a single subgroup; '3/4 пг' for combined.
 */
function formatSubgroup(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  if (/[\d/\s,]+/.test(trimmed) && /\d/.test(trimmed)) {
    return `${trimmed.replace(/\s+/g, '')} пг`
  }
  return trimmed
}

function mergeTooltipEntries(entries: SlotEntry[]): TooltipPerSubject[] {
  const map = new Map<string, TooltipPerSubject>()
  entries.forEach((entry) => {
    const key = [entry.subject, entry.teacher, entry.type, entry.time, entry.cancelled].join('|')
    const current = map.get(key)
    if (current) {
      if (entry.group && !current.groups.some((g) => g.name === entry.group && g.subgroup === entry.subgroup)) {
        current.groups.push({
          name: entry.group,
          subgroup: entry.subgroup || null,
          course: entry.course,
        })
      }
      if (entry.course && !current.teacherCourses.includes(entry.course)) {
        current.teacherCourses.push(entry.course)
      }
      return
    }
    map.set(key, {
      subject: entry.subject,
      teacher: entry.teacher,
      teacherCourses: entry.course ? [entry.course] : [],
      type: entry.type,
      subgroup: entry.subgroup,
      time: entry.time,
      groups: entry.group
        ? [{ name: entry.group, subgroup: entry.subgroup || null, course: entry.course }]
        : [],
      cancelled: entry.cancelled,
    })
  })
  // sort teacher courses
  map.forEach((v) => v.teacherCourses.sort((a, b) => a - b))
  return Array.from(map.values())
}

function shortenSubject(subject: string) {
  if (!subject) return 'Занято'
  return subject.length > 14 ? `${subject.slice(0, 13)}…` : subject
}

function buildOccupancy(
  weeks: WeekSchedule[],
  groups: (ScheduleGroup | ScheduleGroupWithCourse)[],
  search: string,
  lessonTypes: LessonType[],
) {
  const occupancy: Record<string, Record<string, Record<number, SlotEntry[]>>> = {}
  const query = normalizeText(search || '')
  weeks.forEach((week) => {
    week.lessons.forEach((lesson) => {
      const room = normalizeRoom(lesson.room)
      if (!room || room === 'ДО') return
      if (lessonTypes.length > 0 && !lessonTypes.includes(lesson.type)) return
      const groupName = getGroupNameById(groups, lesson.group)
      if (query) {
        const haystack = [
          room,
          lesson.subject,
          lesson.teacher,
          lesson.day,
          lesson.time,
          lesson.subgroup,
          groupName,
        ]
          .map(normalizeText)
          .join(' ')
        if (!haystack.includes(query)) return
      }
      if (!occupancy[room]) occupancy[room] = {}
      const day = lesson.day
      if (!occupancy[room][day]) occupancy[room][day] = {}
      const duration = Math.max(lesson.duration || 1, 1)
      const groupInfo = groups.find((g) => g.id === lesson.group) as
        | ScheduleGroupWithCourse
        | undefined
      const courseNumber = lesson.course_number ?? groupInfo?.course
      for (let p = lesson.pair; p < lesson.pair + duration; p += 1) {
        if (!occupancy[room][day][p]) occupancy[room][day][p] = []
        occupancy[room][day][p].push({
          subject: lesson.subject || '',
          teacher: lesson.teacher || '',
          group: groupName,
          groupId: lesson.group,
          course: courseNumber,
          type: lesson.type,
          subgroup: lesson.subgroup || '',
          time: PAIR_TIMES[p] || '',
          pair: p,
          cancelled: Boolean(lesson.cancelled),
          room,
        })
      }
    })
  })

  const allRooms = Object.keys(occupancy)
  const buckets: Record<Category, string[]> = {
    'lecture-hall': [],
    computer: [],
    regular: [],
  }
  const categoryByRoom: Record<string, Category> = {}
  allRooms.forEach((room) => {
    const cat = categorizeRoom(room).tone as Category
    buckets[cat].push(room)
    categoryByRoom[room] = cat
  })
  const numericSort = (a: string, b: string) => {
    const numA = parseInt(a.replace(/\D+/g, ''), 10)
    const numB = parseInt(b.replace(/\D+/g, ''), 10)
    if (!Number.isNaN(numA) && !Number.isNaN(numB) && numA !== numB) return numA - numB
    return a.localeCompare(b, 'ru')
  }
  ;(Object.keys(buckets) as Category[]).forEach((key) => buckets[key].sort(numericSort))
  const orderedRooms = [...buckets['lecture-hall'], ...buckets.computer, ...buckets.regular]
  const categoryStart: Record<string, boolean> = {}
  ;(['lecture-hall', 'computer', 'regular'] as const).forEach((cat) => {
    const first = buckets[cat][0]
    if (first) categoryStart[first] = true
  })
  return { occupancy, orderedRooms, categoryStart, categoryByRoom }
}
