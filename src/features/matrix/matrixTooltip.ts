export interface MatrixTooltipInput {
  subject: string
  counterpart: string
  type: string
  time: string
  group: string
  subgroup: string | null
  course?: number
  cancelled: boolean
}

export interface MatrixTooltipGroup {
  name: string
  subgroup: string | null
  course?: number
}

export interface MatrixTooltipSummary {
  subject: string
  counterpart: string
  counterpartCourses: number[]
  type: string
  time: string
  groups: MatrixTooltipGroup[]
  cancelled: boolean
}

export function buildTooltipSummary<T>(entries: T[], mapEntry: (entry: T) => MatrixTooltipInput) {
  const map = new Map<string, MatrixTooltipSummary>()
  entries.forEach((entry) => {
    const item = mapEntry(entry)
    const key = [item.subject, item.counterpart, item.type, item.time, item.cancelled].join('|')
    const current = map.get(key)
    if (current) {
      if (item.group && !current.groups.some((group) => group.name === item.group && group.subgroup === item.subgroup)) {
        current.groups.push({ name: item.group, subgroup: item.subgroup || null, course: item.course })
      }
      if (item.course && !current.counterpartCourses.includes(item.course)) {
        current.counterpartCourses.push(item.course)
      }
      return
    }
    map.set(key, {
      subject: item.subject,
      counterpart: item.counterpart,
      counterpartCourses: item.course ? [item.course] : [],
      type: item.type,
      time: item.time,
      groups: item.group ? [{ name: item.group, subgroup: item.subgroup || null, course: item.course }] : [],
      cancelled: item.cancelled,
    })
  })
  map.forEach((entry) => entry.counterpartCourses.sort((a, b) => a - b))
  return Array.from(map.values())
}

export function formatSubgroup(raw: string): string {
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

export function formatTooltipGroup(group: MatrixTooltipGroup) {
  return `${group.name}${group.subgroup ? ` (${formatSubgroup(group.subgroup)})` : ''}`
}

export function formatTooltipGroups(groups: MatrixTooltipGroup[], includeCourseOnlyWhenMultiple = false) {
  const byCourse = new Map<string, string[]>()
  groups.forEach((group) => {
    const key = group.course ? String(group.course) : ''
    if (!byCourse.has(key)) byCourse.set(key, [])
    byCourse.get(key)!.push(formatTooltipGroup(group))
  })
  const courseKeys = Array.from(byCourse.keys()).filter(Boolean)
  return Array.from(byCourse.entries())
    .map(([course, values]) => {
      const shouldShowCourse = course && (!includeCourseOnlyWhenMultiple || courseKeys.length > 1)
      return shouldShowCourse ? `${course} курс: ${values.join(', ')}` : values.join(', ')
    })
    .join('; ')
}
