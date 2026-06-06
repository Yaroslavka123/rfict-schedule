import { filterRoomMatrix, roomSlotKey, type MatrixCellFilter } from '@/features/matrix/matrixFilter'
import type { MatrixAdapter, MatrixCellBadge, MatrixTooltipBlock } from '@/features/matrix/matrixTypes'
import { LESSON_TYPE_LABELS } from '@/lib/constants'
import type { RoomCell, RoomOccupancyIndex, RoomSlotEntry } from '@/stores/scheduleStore'
import type { LessonType } from '@/types/schedule'

interface TooltipPerSubject {
  subject: string
  teacher: string
  teacherCourses: number[]
  type: string
  time: string
  groups: { name: string; subgroup: string | null; course?: number }[]
  cancelled: boolean
}

function summarizeRoomEntries(entries: RoomSlotEntry[]): RoomCell {
  return {
    entries,
    allCancelled: entries.every((entry) => entry.cancelled),
    types: Array.from(new Set(entries.map((entry) => entry.type))),
    groups: Array.from(new Set(entries.map((entry) => entry.group).filter(Boolean))),
    teachers: Array.from(new Set(entries.map((entry) => entry.teacher).filter(Boolean))),
    first: entries[0],
  }
}

function buildRoomCellMap(source: RoomOccupancyIndex, cells: MatrixCellFilter | null) {
  if (cells === null) return null
  const map = new Map<string, RoomCell>()
  cells.forEach(([key, entryIndexes]) => {
    const [encodedRoom, day, pairValue] = key.split('|')
    const room = decodeURIComponent(encodedRoom || '')
    const cell = source.occupancy[room]?.[day]?.[Number(pairValue)]
    if (!cell) return
    const entries = entryIndexes
      .map((index) => cell.entries[index])
      .filter((entry): entry is RoomSlotEntry => Boolean(entry))
    if (entries.length === 0) return
    map.set(key, entries.length === cell.entries.length ? cell : summarizeRoomEntries(entries))
  })
  return map
}

function formatSubgroup(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  if (/\d/.test(trimmed)) {
    return trimmed
      .split(',')
      .map((part) => `${part.trim().replace(/\s+/g, '')} пг`)
      .join(', ')
  }
  return trimmed
}

function mergeTooltipEntries(entries: RoomSlotEntry[]): TooltipPerSubject[] {
  const map = new Map<string, TooltipPerSubject>()
  entries.forEach((entry) => {
    const key = [entry.subject, entry.teacher, entry.type, entry.time, entry.cancelled].join('|')
    const current = map.get(key)
    if (current) {
      if (entry.group && !current.groups.some((group) => group.name === entry.group && group.subgroup === entry.subgroup)) {
        current.groups.push({ name: entry.group, subgroup: entry.subgroup || null, course: entry.course })
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
      time: entry.time,
      groups: entry.group ? [{ name: entry.group, subgroup: entry.subgroup || null, course: entry.course }] : [],
      cancelled: entry.cancelled,
    })
  })
  map.forEach((entry) => entry.teacherCourses.sort((a, b) => a - b))
  return Array.from(map.values())
}

function formatTooltipGroup(group: TooltipPerSubject['groups'][number]) {
  return `${group.name}${group.subgroup ? ` (${formatSubgroup(group.subgroup)})` : ''}`
}

function formatTooltipGroups(groups: TooltipPerSubject['groups']) {
  const byCourse = new Map<string, string[]>()
  groups.forEach((group) => {
    const key = group.course ? String(group.course) : ''
    if (!byCourse.has(key)) byCourse.set(key, [])
    byCourse.get(key)!.push(formatTooltipGroup(group))
  })
  const courseKeys = Array.from(byCourse.keys()).filter(Boolean)
  return Array.from(byCourse.entries())
    .map(([course, values]) => course && courseKeys.length > 1 ? `${course} курс: ${values.join(', ')}` : values.join(', '))
    .join('; ')
}

function shortenSubject(subject: string) {
  if (!subject) return 'Занято'
  return subject.length > 14 ? `${subject.slice(0, 13)}...` : subject
}

function typeClass(cell: RoomCell) {
  if (cell.allCancelled) return 'slot-cancelled'
  if (cell.types.length > 1) return 'slot-type-multi'
  return `slot-type-${cell.types[0] || 'unknown'}`
}

export const roomMatrixAdapter: MatrixAdapter = {
  kind: 'rooms',
  scope: 'rooms',
  pageClass: 'rooms-page',
  wrapClass: 'room-matrix-wrap',
  tableClass: 'room-matrix',
  headerClass: 'th-room matrix-draggable-header',
  emptyTitle: 'Кабинеты не найдены',
  emptyDescription: 'Проверьте фильтры по группе, типу занятия или поиску.',
  groupCornerLabel: 'Группы',
  ungroupedTitle: 'Без группы',
  addGroupTitle: 'Создать группу кабинетов',
  addGroupPrompt: 'Название группы кабинетов',
  emptyGroupTitle: 'Перетащите кабинет в группу',
  emptyGroupLabel: 'Перетащите',
  deleteGroupTitle: 'Удалить группу',

  getOrderedColumns(source) {
    return (source as RoomOccupancyIndex).orderedRooms
  },
  getColumnTitle(column) {
    return column
  },
  getColumnLabel(column) {
    return column
  },
  getColumnLabelClass() {
    return null
  },
  getHeaderClasses(source, column, isMatch, isDim) {
    if (!column) return []
    const category = (source as RoomOccupancyIndex | null)?.categoryByRoom[column]
    return [
      category && `th-cat-${category}`,
      category && `cat-bg-${category}`,
      isMatch && 'th-room-match',
      isDim && 'th-room-dim',
    ].filter(Boolean) as string[]
  },
  getFreeCellClasses(source, column) {
    const category = (source as RoomOccupancyIndex | null)?.categoryByRoom[column]
    return category ? [`cat-bg-${category}`] : []
  },
  getBusyCellClasses(cell) {
    return [typeClass(cell as RoomCell)]
  },
  getCell(source, column, day, pair) {
    return (source as RoomOccupancyIndex).occupancy[column]?.[day]?.[pair] || null
  },
  getCellEntries(cell) {
    return (cell as RoomCell).entries
  },
  getCellMain(cell) {
    return shortenSubject((cell as RoomCell).first.subject)
  },
  getCellMeta(cell) {
    return (cell as RoomCell).groups[0] || null
  },
  getCellMainClass(cell) {
    return (cell as RoomCell).allCancelled ? 'line-through' : null
  },
  getCellBadges(cell) {
    const roomCell = cell as RoomCell
    const badges: MatrixCellBadge[] = []
    if (roomCell.teachers.length > 1) {
      badges.push({
        className: 'slot-badge slot-badge-teacher',
        title: `Преподавателей: ${roomCell.teachers.length}`,
        value: roomCell.teachers.length,
      })
    }
    if (roomCell.groups.length > 1) {
      badges.push({
        className: 'slot-badge slot-badge-group',
        title: `Групп: ${roomCell.groups.length}`,
        value: roomCell.groups.length,
      })
    }
    return badges
  },
  getSheetId(entries) {
    return (entries as RoomSlotEntry[]).find((entry) => entry.googleSheetId)?.googleSheetId || null
  },
  slotKey: roomSlotKey,
  filter(source, activeGroup, query, types) {
    return filterRoomMatrix(source as RoomOccupancyIndex | null, activeGroup, query, types)
  },
  buildCellMap(source, cells) {
    return buildRoomCellMap(source as RoomOccupancyIndex, cells)
  },
  getTooltipHeader(column) {
    return column ? { className: 'mb-1 font-bold text-amber-500', text: `Кабинет: ${column}` } : null
  },
  getTooltipBlocks(_column, entries) {
    return mergeTooltipEntries(entries as RoomSlotEntry[]).map((entry, index): MatrixTooltipBlock => ({
      key: `${entry.subject}-${entry.teacher}-${index}`,
      title: entry.subject || '—',
      titleClass: `font-bold ${entry.cancelled ? 'text-red-500 line-through' : 'text-primary'}`,
      cancelled: entry.cancelled,
      lines: [
        {
          className: 'text-muted-foreground',
          text: `${entry.teacher || '—'}${entry.teacherCourses.length > 0 ? ` · ${entry.teacherCourses.map((course) => `${course} курс`).join(', ')}` : ''}`,
        },
        { className: 'text-emerald-400', text: entry.groups.length > 0 ? formatTooltipGroups(entry.groups) : '—' },
        ...(entry.type ? [{ className: 'text-purple-400', text: LESSON_TYPE_LABELS[entry.type as LessonType] || entry.type }] : []),
        ...(entry.time ? [{ className: 'text-muted-foreground', text: entry.time }] : []),
      ],
    }))
  },
}
