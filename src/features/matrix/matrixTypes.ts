import type { ColumnGroupScope } from '@/stores/columnGroups'
import type { LessonType } from '@/types/schedule'

export type MatrixKind = 'rooms' | 'teachers'

export interface MatrixCellMeta {
  column: string
  day: string
  pair: number
  key: string
}

export interface MatrixCellBadge {
  className: string
  title: string
  value: number
}

export interface MatrixRenderCell {
  entries: unknown[]
  precomputedKey: string
  precomputedMain: string
  precomputedMainClass: string | null
  precomputedMeta: string | null
  precomputedBadges: MatrixCellBadge[]
  precomputedBusyClasses: string[]
  precomputedSheetId: string | null
  precomputedHasSheet: boolean
}

export interface MatrixTooltipLine {
  className?: string
  text: string
}

export interface MatrixTooltipBlock {
  key: string
  title: string
  titleClass: string
  lines: MatrixTooltipLine[]
  cancelled: boolean
}

export interface MatrixTooltipHeader {
  className: string
  text: string
}

export interface MatrixAdapter {
  kind: MatrixKind
  scope: ColumnGroupScope
  pageClass: string
  wrapClass: string
  tableClass: string
  headerClass: string
  emptyTitle: string
  emptyDescription: string
  groupCornerLabel: string
  ungroupedTitle: string
  addGroupTitle: string
  addGroupPrompt: string
  emptyGroupTitle: string
  emptyGroupLabel: string
  deleteGroupTitle: string

  getOrderedColumns(source: unknown): string[]
  getColumnTitle(column: string): string
  getColumnLabel(column: string): string
  getColumnLabelClass(column: string): string | null
  getHeaderClasses(source: unknown | null, column: string, isMatch: boolean, isDim: boolean): string[]
  getFreeCellClasses(source: unknown | null, column: string): string[]
  getBusyCellClasses(cell: MatrixRenderCell): string[]
  getCell(source: unknown, column: string, day: string, pair: number): MatrixRenderCell | null
  getCellEntries(cell: MatrixRenderCell): unknown[]
  getCellMain(cell: MatrixRenderCell): string
  getCellMeta(cell: MatrixRenderCell): string | null
  getCellMainClass(cell: MatrixRenderCell): string | null
  getCellBadges(cell: MatrixRenderCell): MatrixCellBadge[]
  getSheetId(cell: MatrixRenderCell): string | null
  slotKey(column: string, day: string, pair: number): string
  filter(source: unknown, activeGroup: string, query: string, types: LessonType[]): {
    cells: [key: string, entryIndexes: number[]][] | null
    matches: ReadonlySet<string> | null
  }
  buildCellMap(source: unknown, cells: [key: string, entryIndexes: number[]][] | null): Map<string, MatrixRenderCell> | null
  getTooltipHeader(column: string, entries: unknown[]): MatrixTooltipHeader | null
  getTooltipBlocks(column: string, entries: unknown[]): MatrixTooltipBlock[]
}
