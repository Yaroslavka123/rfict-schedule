import { filterRoomMatrix, roomSlotKey, type MatrixCellFilter } from '@/features/matrix/matrixFilter'
import { buildTooltipSummary, formatTooltipGroups } from '@/features/matrix/matrixTooltip'
import type { MatrixAdapter, MatrixTooltipBlock } from '@/features/matrix/matrixTypes'
import { LESSON_TYPE_LABELS } from '@/lib/constants'
import { roomCell, type RoomCell, type RoomOccupancyIndex, type RoomSlotEntry } from '@/stores/scheduleStore'
import type { LessonType } from '@/types/schedule'

function summarizeRoomEntries(entries: RoomSlotEntry[], key: string): RoomCell {
  return roomCell(entries, key)
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
    map.set(key, entries.length === cell.entries.length ? cell : summarizeRoomEntries(entries, key))
  })
  return map
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
    return cell.precomputedBusyClasses
  },
  getCell(source, column, day, pair) {
    return (source as RoomOccupancyIndex).occupancy[column]?.[day]?.[pair] || null
  },
  getCellEntries(cell) {
    return (cell as RoomCell).entries
  },
  getCellMain(cell) {
    return cell.precomputedMain
  },
  getCellMeta(cell) {
    return cell.precomputedMeta
  },
  getCellMainClass(cell) {
    return cell.precomputedMainClass
  },
  getCellBadges(cell) {
    return cell.precomputedBadges
  },
  getSheetId(cell) {
    return cell.precomputedSheetId
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
    return buildTooltipSummary(entries as RoomSlotEntry[], (entry) => ({
      subject: entry.subject,
      counterpart: entry.teacher,
      type: entry.type,
      time: entry.time,
      group: entry.group,
      subgroup: entry.subgroup || null,
      course: entry.course,
      cancelled: entry.cancelled,
    })).map((entry, index): MatrixTooltipBlock => ({
      key: `${entry.subject}-${entry.counterpart}-${index}`,
      title: entry.subject || '—',
      titleClass: `font-bold ${entry.cancelled ? 'text-red-500 line-through' : 'text-primary'}`,
      cancelled: entry.cancelled,
      lines: [
        {
          className: 'text-muted-foreground',
          text: `${entry.counterpart || '—'}${entry.counterpartCourses.length > 0 ? ` · ${entry.counterpartCourses.map((course) => `${course} курс`).join(', ')}` : ''}`,
        },
        { className: 'text-emerald-400', text: entry.groups.length > 0 ? formatTooltipGroups(entry.groups, true) : '—' },
        ...(entry.type ? [{ className: 'text-purple-400', text: LESSON_TYPE_LABELS[entry.type as LessonType] || entry.type }] : []),
        ...(entry.time ? [{ className: 'text-muted-foreground', text: entry.time }] : []),
      ],
    }))
  },
}
