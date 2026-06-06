import { cn } from '@/lib/utils'
import {
  buildColumnSections,
  buildColumnSlots,
  type ColumnSection,
  type ColumnSlot,
} from '@/stores/columnGroups'

export { buildColumnSections, buildColumnSlots, type ColumnSection, type ColumnSlot }

export function matrixColumnClass(index: number) {
  return `matrix-col-${index}`
}

export function matchedColumnTokens(slots: ColumnSlot[], matches: ReadonlySet<string> | null) {
  if (!matches) return ''
  return slots
    .map((slot, index) => (slot.column && matches.has(slot.column) ? matrixColumnClass(index) : ''))
    .filter(Boolean)
    .join(' ')
}

export function groupToneClass(tone: number | undefined) {
  return tone === undefined ? null : `matrix-group-tone-${tone}`
}

export function groupSlotClasses(slot: ColumnSlot) {
  return cn(
    groupToneClass(slot.tone),
    slot.groupId && 'matrix-user-group-member',
    slot.groupStart && 'matrix-group-start',
    slot.groupEnd && 'matrix-group-end',
  )
}
