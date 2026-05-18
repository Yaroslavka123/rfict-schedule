import { useMemo, useState } from 'react'

import { Card, CardContent } from '@/components/ui/card'
import { LESSON_TYPE_LABELS, PAIRS, PAIR_TIMES } from '@/lib/constants'
import { categorizeRoom, getGroupNameById, normalizeRoom } from '@/lib/schedule'
import { cn } from '@/lib/utils'
import type { LessonType, ScheduleGroup, WeekSchedule } from '@/types/schedule'

interface RoomsViewProps {
  weeks: WeekSchedule[]
  groups: ScheduleGroup[]
  selectedWeek: number
  onWeekChange: (week: number) => void
}

interface SlotEntry {
  subject: string
  teacher: string
  group: string
  type: LessonType
  subgroup: string
  time: string
  pair: number
  cancelled: boolean
  room: string
}

const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']

export function RoomsView({ weeks, groups, selectedWeek, onWeekChange }: RoomsViewProps) {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; entries: SlotEntry[] } | null>(null)

  const activeWeek = useMemo(() => {
    if (weeks.length === 0) return null
    return weeks.find((week) => week.week_number === selectedWeek) || weeks[weeks.length - 1]
  }, [weeks, selectedWeek])

  const { occupancy, orderedRooms, categoryStart } = useMemo(() => buildOccupancy(activeWeek, groups), [activeWeek, groups])

  if (!activeWeek) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">Нет данных за выбранный курс.</CardContent>
      </Card>
    )
  }

  if (orderedRooms.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">Кабинеты не найдены.</CardContent>
      </Card>
    )
  }

  const showTooltip = (event: React.MouseEvent<HTMLTableCellElement>, entries: SlotEntry[]) => {
    setTooltip({ x: event.clientX + 12, y: event.clientY + 12, entries })
  }

  const hideTooltip = () => setTooltip(null)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Неделя</div>
        <div className="flex flex-wrap gap-1">
          {weeks.map((week) => (
            <button
              key={week.week_number}
              type="button"
              className={
                week.week_number === activeWeek.week_number
                  ? 'rounded-md border border-primary bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary'
                  : 'rounded-md border border-border bg-background px-2.5 py-1 text-xs font-semibold text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground'
              }
              onClick={() => onWeekChange(week.week_number)}
              title={week.name}
            >
              {week.week_number}-я
            </button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Legend dotClass="bg-amber-500">Поточные</Legend>
          <Legend dotClass="bg-sky-500">Комп. классы</Legend>
          <Legend dotClass="bg-emerald-500">Кабинеты</Legend>
          <Legend dotClass="bg-purple-500">Несколько</Legend>
        </div>
      </div>

      <div className="room-matrix-wrap">
        <table className="room-matrix" onMouseLeave={hideTooltip}>
          <thead>
            <tr>
              <th className="th-day">Д</th>
              <th className="th-pair">П</th>
              {orderedRooms.map((room) => {
                const cat = categorizeRoom(room).tone
                const start = categoryStart[room]
                return (
                  <th key={room} className={cn('th-room', `th-cat-${cat}`, start && 'room-cat-start')} title={room}>
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
                    const cat = categorizeRoom(room).tone
                    const start = categoryStart[room]
                    if (entries.length === 0) {
                      return <td key={room} className={cn('slot-free', start && 'room-cat-start')} />
                    }
                    const allCancelled = entries.every((entry) => entry.cancelled)
                    const slotClass = allCancelled
                      ? 'slot-cancelled'
                      : entries.length > 1
                      ? 'slot-multi'
                      : `slot-${cat}`
                    const first = entries[0]
                    const groupSet = Array.from(new Set(entries.map((entry) => entry.group).filter(Boolean)))
                    const teacherSet = Array.from(
                      new Set(entries.map((entry) => entry.teacher).filter(Boolean)),
                    )
                    const meta = groupSet.length > 0 ? groupSet.join(', ') : first.teacher
                    return (
                      <td
                        key={room}
                        className={cn('slot-busy', slotClass, start && 'room-cat-start')}
                        onMouseEnter={(event) => showTooltip(event, entries)}
                        onMouseMove={(event) => showTooltip(event, entries)}
                        onMouseLeave={hideTooltip}
                      >
                        <div className="slot-content">
                          <div className={cn('slot-main', allCancelled && 'line-through text-red-500')}>
                            {shortenSubject(first.subject)}
                          </div>
                          {meta && (
                            <div className={cn('slot-meta', allCancelled && 'text-red-500/80')}>{meta}</div>
                          )}
                        </div>
                        {teacherSet.length > 1 && (
                          <span className="slot-badge slot-badge-teacher" title={`Преподавателей: ${teacherSet.length}`}>
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
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card/40 px-2 py-0.5">
      <span className={cn('h-2 w-2 rounded-full', dotClass)} />
      {children}
    </span>
  )
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
          <div className="text-muted-foreground">{entry.teacher || '—'}</div>
          <div className="text-emerald-400">Группы: {entry.groups.length > 0 ? entry.groups.join(', ') : '—'}</div>
          {entry.subgroup && <div className="text-amber-400">Подгруппа: {entry.subgroup}</div>}
          {entry.type && <div className="text-purple-400">{LESSON_TYPE_LABELS[entry.type as LessonType] || entry.type}</div>}
          {entry.time && <div className="text-muted-foreground">{entry.time}</div>}
          {entry.cancelled && <div className="font-semibold text-red-500">Пара отменена</div>}
        </div>
      ))}
    </div>
  )
}

interface MergedTooltipEntry {
  subject: string
  teacher: string
  type: string
  subgroup: string
  time: string
  groups: string[]
  cancelled: boolean
}

function mergeTooltipEntries(entries: SlotEntry[]): MergedTooltipEntry[] {
  const map = new Map<string, MergedTooltipEntry>()
  entries.forEach((entry) => {
    const key = [entry.subject, entry.teacher, entry.type, entry.subgroup, entry.time, entry.cancelled].join('|')
    const current = map.get(key)
    if (current) {
      if (entry.group && !current.groups.includes(entry.group)) current.groups.push(entry.group)
      return
    }
    map.set(key, {
      subject: entry.subject,
      teacher: entry.teacher,
      type: entry.type,
      subgroup: entry.subgroup,
      time: entry.time,
      groups: entry.group ? [entry.group] : [],
      cancelled: entry.cancelled,
    })
  })
  return Array.from(map.values())
}

function shortenSubject(subject: string) {
  if (!subject) return 'Занято'
  return subject.length > 14 ? `${subject.slice(0, 13)}…` : subject
}

function buildOccupancy(week: WeekSchedule | null, groups: ScheduleGroup[]) {
  const occupancy: Record<string, Record<string, Record<number, SlotEntry[]>>> = {}
  if (!week) return { occupancy, orderedRooms: [] as string[], categoryStart: {} as Record<string, boolean> }

  week.lessons.forEach((lesson) => {
    const room = normalizeRoom(lesson.room)
    if (!room || room === 'ДО') return
    if (!occupancy[room]) occupancy[room] = {}
    const day = lesson.day
    if (!occupancy[room][day]) occupancy[room][day] = {}
    const duration = Math.max(lesson.duration || 1, 1)
    for (let p = lesson.pair; p < lesson.pair + duration; p += 1) {
      if (!occupancy[room][day][p]) occupancy[room][day][p] = []
      occupancy[room][day][p].push({
        subject: lesson.subject || '',
        teacher: lesson.teacher || '',
        group: getGroupNameById(groups, lesson.group),
        type: lesson.type,
        subgroup: lesson.subgroup || '',
        time: PAIR_TIMES[p] || '',
        pair: p,
        cancelled: Boolean(lesson.cancelled),
        room,
      })
    }
  })

  const allRooms = Object.keys(occupancy)
  const buckets: Record<'lecture-hall' | 'computer' | 'regular', string[]> = {
    'lecture-hall': [],
    computer: [],
    regular: [],
  }
  allRooms.forEach((room) => {
    buckets[categorizeRoom(room).tone].push(room)
  })
  const numericSort = (a: string, b: string) => {
    const numA = parseInt(a.replace(/\D+/g, ''), 10)
    const numB = parseInt(b.replace(/\D+/g, ''), 10)
    if (!Number.isNaN(numA) && !Number.isNaN(numB) && numA !== numB) return numA - numB
    return a.localeCompare(b, 'ru')
  }
  ;(Object.keys(buckets) as Array<keyof typeof buckets>).forEach((key) => buckets[key].sort(numericSort))
  const orderedRooms = [...buckets['lecture-hall'], ...buckets.computer, ...buckets.regular]
  const categoryStart: Record<string, boolean> = {}
  ;(['lecture-hall', 'computer', 'regular'] as const).forEach((cat) => {
    const first = buckets[cat][0]
    if (first) categoryStart[first] = true
  })
  return { occupancy, orderedRooms, categoryStart }
}
