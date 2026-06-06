export type MatrixDropSide = 'before' | 'after'

export type MatrixDropTarget =
  | { type: 'column'; column: string; side: MatrixDropSide }
  | { type: 'group'; groupId: string }
  | null

const EDGE_SCROLL_ZONE = 72
const MAX_SCROLL_STEP = 22

function scrollStep(distanceIntoZone: number) {
  const ratio = Math.max(0, Math.min(distanceIntoZone / EDGE_SCROLL_ZONE, 1))
  return Math.ceil(ratio * MAX_SCROLL_STEP)
}

export function resolveMatrixDropTarget(clientX: number, clientY: number, sourceColumn: string): MatrixDropTarget {
  const element = document.elementFromPoint(clientX, clientY) as HTMLElement | null
  if (!element) return null

  const columnElement = element.closest<HTMLElement>('[data-matrix-column]')
  const column = columnElement?.dataset.matrixColumn
  if (column) {
    if (column === sourceColumn) return null
    const rect = columnElement.getBoundingClientRect()
    return {
      type: 'column',
      column,
      side: clientX < rect.left + rect.width / 2 ? 'before' : 'after',
    }
  }

  const groupElement = element.closest<HTMLElement>('[data-matrix-group-id]')
  const groupId = groupElement?.dataset.matrixGroupId
  if (groupId) return { type: 'group', groupId }

  return null
}

export function autoScrollMatrixWrap(wrap: HTMLElement | null, clientX: number, clientY: number) {
  if (!wrap) return
  const rect = wrap.getBoundingClientRect()
  let nextLeft = wrap.scrollLeft
  let nextTop = wrap.scrollTop

  if (clientX < rect.left + EDGE_SCROLL_ZONE) {
    nextLeft -= scrollStep(rect.left + EDGE_SCROLL_ZONE - clientX)
  } else if (clientX > rect.right - EDGE_SCROLL_ZONE) {
    nextLeft += scrollStep(clientX - (rect.right - EDGE_SCROLL_ZONE))
  }

  if (clientY < rect.top + EDGE_SCROLL_ZONE) {
    nextTop -= scrollStep(rect.top + EDGE_SCROLL_ZONE - clientY)
  } else if (clientY > rect.bottom - EDGE_SCROLL_ZONE) {
    nextTop += scrollStep(clientY - (rect.bottom - EDGE_SCROLL_ZONE))
  }

  if (nextLeft !== wrap.scrollLeft) wrap.scrollLeft = nextLeft
  if (nextTop !== wrap.scrollTop) wrap.scrollTop = nextTop
}
