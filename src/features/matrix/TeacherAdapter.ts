import { filterTeacherMatrix, teacherSlotKey, type MatrixCellFilter } from '@/features/matrix/matrixFilter'
import { buildTooltipSummary, formatTooltipGroups } from '@/features/matrix/matrixTooltip'
import type { MatrixAdapter, MatrixCellBadge, MatrixTooltipBlock } from '@/features/matrix/matrixTypes'
import { LESSON_TYPE_LABELS } from '@/lib/constants'
import type { TeacherCell, TeacherOccupancyIndex, TeacherSlotEntry } from '@/stores/scheduleStore'

function summarizeTeacherEntries(entries: TeacherSlotEntry[]): TeacherCell {
  return {
    entries,
    allCancelled: entries.every((entry) => entry.cancelled),
    types: Array.from(new Set(entries.map((entry) => entry.type))),
    rooms: Array.from(new Set(entries.map((entry) => entry.room).filter(Boolean))),
  }
}

function buildTeacherCellMap(source: TeacherOccupancyIndex, cells: MatrixCellFilter | null) {
  if (cells === null) return null
  const map = new Map<string, TeacherCell>()
  cells.forEach(([key, entryIndexes]) => {
    const [encodedTeacher, day, pairValue] = key.split('|')
    const teacher = decodeURIComponent(encodedTeacher || '')
    const cell = source.occupancy[teacher]?.[day]?.[Number(pairValue)]
    if (!cell) return
    const entries = entryIndexes
      .map((index) => cell.entries[index])
      .filter((entry): entry is TeacherSlotEntry => Boolean(entry))
    if (entries.length === 0) return
    map.set(key, entries.length === cell.entries.length ? cell : summarizeTeacherEntries(entries))
  })
  return map
}

function shortTeacherName(full: string): string {
  const trimmed = full.trim()
  if (trimmed.length <= 22) return trimmed
  return `${trimmed.slice(0, 21)}...`
}

function typeClass(cell: TeacherCell) {
  if (cell.allCancelled) return 'slot-cancelled'
  if (cell.types.length > 1) return 'slot-type-multi'
  return `slot-type-${cell.types[0] || 'unknown'}`
}

export const teacherMatrixAdapter: MatrixAdapter = {
  kind: 'teachers',
  scope: 'teachers',
  pageClass: 'teachers-page',
  wrapClass: 'teachers-matrix-wrap',
  tableClass: 'teachers-matrix',
  headerClass: 'th-teacher matrix-draggable-header',
  emptyTitle: 'Преподаватели не найдены',
  emptyDescription: 'Измените тип занятия или поисковый запрос.',
  groupCornerLabel: 'Группы',
  ungroupedTitle: 'Без группы',
  addGroupTitle: 'Создать группу преподавателей',
  addGroupPrompt: 'Название группы преподавателей',
  emptyGroupTitle: 'Перетащите преподавателя в группу',
  emptyGroupLabel: 'Перетащите',
  deleteGroupTitle: 'Удалить группу',

  getOrderedColumns(source) {
    return (source as TeacherOccupancyIndex).orderedTeachers
  },
  getColumnTitle(column) {
    return column
  },
  getColumnLabel(column) {
    return shortTeacherName(column)
  },
  getColumnLabelClass() {
    return 'th-teacher-label'
  },
  getHeaderClasses(_source, _column, isMatch, isDim) {
    return [isMatch && 'th-teacher-match', isDim && 'th-teacher-dim'].filter(Boolean) as string[]
  },
  getFreeCellClasses() {
    return []
  },
  getBusyCellClasses(cell) {
    return [typeClass(cell as TeacherCell)]
  },
  getCell(source, column, day, pair) {
    return (source as TeacherOccupancyIndex).occupancy[column]?.[day]?.[pair] || null
  },
  getCellEntries(cell) {
    return (cell as TeacherCell).entries
  },
  getCellMain(cell) {
    return (cell as TeacherCell).rooms[0] || '—'
  },
  getCellMeta() {
    return null
  },
  getCellMainClass(cell) {
    return (cell as TeacherCell).allCancelled ? 'line-through' : null
  },
  getCellBadges(cell) {
    const teacherCell = cell as TeacherCell
    const badges: MatrixCellBadge[] = []
    if (teacherCell.rooms.length > 1) {
      badges.push({
        className: 'slot-badge slot-badge-group',
        title: `Кабинетов: ${teacherCell.rooms.length}`,
        value: teacherCell.rooms.length,
      })
    }
    return badges
  },
  getSheetId(entries) {
    return (entries as TeacherSlotEntry[]).find((entry) => entry.googleSheetId)?.googleSheetId || null
  },
  slotKey: teacherSlotKey,
  filter(source, activeGroup, query, types) {
    return filterTeacherMatrix(source as TeacherOccupancyIndex | null, activeGroup, query, types)
  },
  buildCellMap(source, cells) {
    return buildTeacherCellMap(source as TeacherOccupancyIndex, cells)
  },
  getTooltipHeader(column) {
    return { className: 'mb-1 font-bold text-primary', text: column || '—' }
  },
  getTooltipBlocks(_column, entries) {
    return buildTooltipSummary(entries as TeacherSlotEntry[], (entry) => ({
      subject: entry.subject,
      counterpart: entry.room,
      type: entry.type,
      time: entry.time,
      group: entry.group,
      subgroup: entry.subgroup || null,
      course: entry.course,
      cancelled: entry.cancelled,
    })).map((entry, index): MatrixTooltipBlock => ({
      key: `${entry.subject}-${entry.counterpart}-${index}`,
      title: entry.subject || '—',
      titleClass: `font-semibold ${entry.cancelled ? 'text-red-500 line-through' : 'text-amber-400'}`,
      cancelled: entry.cancelled,
      lines: [
        { className: 'text-emerald-400', text: `Кабинет: ${entry.counterpart || '—'}` },
        { className: 'text-emerald-400', text: entry.groups.length > 0 ? formatTooltipGroups(entry.groups) : '—' },
        ...(entry.type ? [{ className: 'text-purple-400', text: LESSON_TYPE_LABELS[entry.type] || entry.type }] : []),
        ...(entry.time ? [{ className: 'text-muted-foreground', text: entry.time }] : []),
      ],
    }))
  },
}
