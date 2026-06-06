import { filterTeacherMatrix, teacherSlotKey, type MatrixCellFilter } from '@/features/matrix/matrixFilter'
import { buildTooltipSummary, formatTooltipGroups } from '@/features/matrix/matrixTooltip'
import type { MatrixAdapter, MatrixTooltipBlock } from '@/features/matrix/matrixTypes'
import { LESSON_TYPE_LABELS } from '@/lib/constants'
import { teacherCell, type TeacherCell, type TeacherOccupancyIndex, type TeacherSlotEntry } from '@/stores/scheduleStore'

function summarizeTeacherEntries(entries: TeacherSlotEntry[], key: string): TeacherCell {
  return teacherCell(entries, key)
}

function buildTeacherCellMap(source: TeacherOccupancyIndex, cells: MatrixCellFilter | null, target = new Map<string, TeacherCell>()) {
  if (cells === null) return null
  target.clear()
  cells.forEach(([key, entryIndexes]) => {
    const [encodedTeacher, day, pairValue] = key.split('|')
    const teacher = decodeURIComponent(encodedTeacher || '')
    const cell = source.occupancy[teacher]?.[day]?.[Number(pairValue)]
    if (!cell) return
    if (entryIndexes === null) {
      target.set(key, cell)
      return
    }
    const entries = entryIndexes
      .map((index) => cell.entries[index])
      .filter((entry): entry is TeacherSlotEntry => Boolean(entry))
    if (entries.length === 0) return
    target.set(key, entries.length === cell.entries.length ? cell : summarizeTeacherEntries(entries, key))
  })
  return target
}

function shortTeacherName(full: string): string {
  const trimmed = full.trim()
  if (trimmed.length <= 22) return trimmed
  return `${trimmed.slice(0, 21)}...`
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
    return cell.precomputedBusyClasses
  },
  getCell(source, column, day, pair) {
    return (source as TeacherOccupancyIndex).occupancy[column]?.[day]?.[pair] || null
  },
  getCellEntries(cell) {
    return (cell as TeacherCell).entries
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
  slotKey: teacherSlotKey,
  filter(source, activeGroup, query, types) {
    return filterTeacherMatrix(source as TeacherOccupancyIndex | null, activeGroup, query, types)
  },
  buildCellMap(source, cells, target) {
    return buildTeacherCellMap(source as TeacherOccupancyIndex, cells, target as Map<string, TeacherCell> | undefined)
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
