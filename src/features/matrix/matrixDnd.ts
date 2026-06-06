export type MatrixDropSide = 'before' | 'after'

export type MatrixDropTarget =
  | { type: 'column'; column: string; side: MatrixDropSide }
  | { type: 'group'; groupId: string }
  | null

const EDGE_SCROLL_ZONE = 72
const MAX_SCROLL_STEP = 22

interface CachedRect {
  left: number
  right: number
  top: number
  bottom: number
  width: number
  stickyY: boolean
}

interface CachedColumn extends CachedRect {
  column: string
}

interface CachedGroup extends CachedRect {
  groupId: string
}

export interface MatrixHitTestCache {
  root: HTMLElement
  scrollLeft: number
  scrollTop: number
  columns: CachedColumn[]
  groups: CachedGroup[]
}

function scrollStep(distanceIntoZone: number) {
  const ratio = Math.max(0, Math.min(distanceIntoZone / EDGE_SCROLL_ZONE, 1))
  return Math.ceil(ratio * MAX_SCROLL_STEP)
}

function cachedRect(element: HTMLElement, stickyY = false): CachedRect {
  const rect = element.getBoundingClientRect()
  return {
    left: rect.left,
    right: rect.right,
    top: rect.top,
    bottom: rect.bottom,
    width: rect.width,
    stickyY,
  }
}

function contains(rect: CachedRect, clientX: number, clientY: number, deltaX: number, deltaY: number) {
  const left = rect.left - deltaX
  const right = rect.right - deltaX
  const top = rect.top - (rect.stickyY ? 0 : deltaY)
  const bottom = rect.bottom - (rect.stickyY ? 0 : deltaY)
  return clientX >= left && clientX <= right && clientY >= top && clientY <= bottom
}

export function createMatrixHitTestCache(root: HTMLElement | null): MatrixHitTestCache | null {
  if (!root) return null
  const rootRect = root.getBoundingClientRect()
  const columns: CachedColumn[] = []
  root.querySelectorAll<HTMLElement>('thead [data-matrix-column]').forEach((element) => {
    const column = element.dataset.matrixColumn
    if (!column) return
    const rect = element.getBoundingClientRect()
    columns.push({
      column,
      left: rect.left,
      right: rect.right,
      top: rootRect.top,
      bottom: rootRect.bottom,
      width: rect.width,
      stickyY: true,
    })
  })

  const groups = Array.from(root.querySelectorAll<HTMLElement>('[data-matrix-group-id]'))
    .map((element) => {
      const groupId = element.dataset.matrixGroupId
      if (!groupId) return null
      return {
        groupId,
        ...cachedRect(element, Boolean(element.closest('thead'))),
      } satisfies CachedGroup
    })
    .filter((item): item is CachedGroup => item !== null)

  return {
    root,
    scrollLeft: root.scrollLeft,
    scrollTop: root.scrollTop,
    columns,
    groups,
  }
}

function resolveFromCache(
  cache: MatrixHitTestCache,
  clientX: number,
  clientY: number,
  sourceColumn: string,
): MatrixDropTarget {
  const deltaX = cache.root.scrollLeft - cache.scrollLeft
  const deltaY = cache.root.scrollTop - cache.scrollTop
  const column = cache.columns.find((item) => item.column !== sourceColumn && contains(item, clientX, clientY, deltaX, 0))
  if (column) {
    const left = column.left - deltaX
    return {
      type: 'column',
      column: column.column,
      side: clientX < left + column.width / 2 ? 'before' : 'after',
    }
  }

  const group = cache.groups.find((item) => contains(item, clientX, clientY, deltaX, deltaY))
  return group ? { type: 'group', groupId: group.groupId } : null
}

export function resolveMatrixDropTarget(
  clientX: number,
  clientY: number,
  sourceColumn: string,
  cache?: MatrixHitTestCache | null,
): MatrixDropTarget {
  if (cache) return resolveFromCache(cache, clientX, clientY, sourceColumn)

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
