const NORMALIZE_CACHE_LIMIT = 5000
const normalizeCache = new Map<string, string>()
const searchNormalizeCache = new Map<string, string>()
const searchKeyCache = new Map<string, string>()

function rememberNormalized(cache: Map<string, string>, key: string, value: string) {
  if (cache.size > NORMALIZE_CACHE_LIMIT) cache.clear()
  cache.set(key, value)
  return value
}

export function normalizeText(value: string | null | undefined) {
  const key = String(value || '')
  const cached = normalizeCache.get(key)
  if (cached !== undefined) return cached
  const normalized = key.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim()
  return rememberNormalized(normalizeCache, key, normalized)
}

const SEARCH_PUNCTUATION_RE = /[.,;:!?()[\]{}"«»'`]+/g
const DISPLAY_PUNCTUATION_RE = /[;:!?()[\]{}"«»'`]+/g
const SEARCH_SPLITTER_RE = /[/\\|+_=*#№]+/g
const SEARCH_DASH_RE = /[-–—]+/g
const COMPACT_INITIALS_RE = /([А-ЯЁа-яё])([А-ЯЁ])\.?\s*([А-ЯЁ])\.?/g
const CYRILLIC_CASE_BOUNDARY_RE = /([а-яё])([А-ЯЁ])/g
const ACADEMIC_TITLE_RE =
  /(^|\s)(доцент[а-я]*|доц|профессор[а-я]*|проф|ст\s*преп|ст\s*пр|старш[а-я]*\s+преподавател[а-я]*|преподавател[а-я]*|преп|пр\s*ст|ассистент[а-я]*|асс)(?=\s|$)/g
const DISPLAY_TITLE_WORDS = new Set([
  'доц',
  'доцент',
  'проф',
  'профессор',
  'преп',
  'преподаватель',
  'асс',
  'ассистент',
])

function repairCompactInitials(value: string) {
  return value
    .replace(COMPACT_INITIALS_RE, '$1 $2 $3')
    .replace(CYRILLIC_CASE_BOUNDARY_RE, '$1 $2')
}

function repairCompactInitialsForDisplay(value: string) {
  return value
    .replace(COMPACT_INITIALS_RE, '$1 $2.$3.')
    .replace(CYRILLIC_CASE_BOUNDARY_RE, '$1 $2')
}

function stripAcademicTitlesFromNormalized(value: string) {
  return value
    .replace(ACADEMIC_TITLE_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function normalizeSearchText(value: string | null | undefined) {
  const key = String(value || '')
  const cached = searchNormalizeCache.get(key)
  if (cached !== undefined) return cached

  const normalized = repairCompactInitials(key)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(SEARCH_PUNCTUATION_RE, ' ')
    .replace(SEARCH_SPLITTER_RE, ' ')
    .replace(SEARCH_DASH_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return rememberNormalized(searchNormalizeCache, key, normalized)
}

export function normalizeSearchQuery(value: string | null | undefined) {
  const raw = normalizeSearchText(value)
  const withoutTitles = stripAcademicTitlesFromNormalized(raw)
  return withoutTitles || raw
}

export function buildSearchKey(value: string | null | undefined) {
  const key = String(value || '')
  const cached = searchKeyCache.get(key)
  if (cached !== undefined) return cached

  const raw = normalizeSearchText(key)
  const withoutTitles = stripAcademicTitlesFromNormalized(raw)
  const variants = new Set<string>()
  if (raw) variants.add(raw)
  if (withoutTitles) variants.add(withoutTitles)
  if (raw) variants.add(raw.replace(/\s+/g, ''))
  if (withoutTitles) variants.add(withoutTitles.replace(/\s+/g, ''))

  return rememberNormalized(searchKeyCache, key, Array.from(variants).join(' '))
}

export function cleanSearchCandidate(value: string | null | undefined) {
  const normalizedTokens = repairCompactInitialsForDisplay(String(value || ''))
    .replace(DISPLAY_PUNCTUATION_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)

  const result: string[] = []
  for (let index = 0; index < normalizedTokens.length; index += 1) {
    const token = normalizedTokens[index]
    const normalized = normalizeSearchText(token)
    const next = normalizeSearchText(normalizedTokens[index + 1])
    if (normalized === 'ст' && (next === 'пр' || next === 'преп')) {
      index += 1
      continue
    }
    if (normalized === 'пр' && next === 'ст') {
      index += 1
      continue
    }
    if (DISPLAY_TITLE_WORDS.has(normalized) || normalized.startsWith('доцент') || normalized.startsWith('профессор')) {
      continue
    }
    if (normalized.startsWith('преподавател') || normalized.startsWith('ассистент')) {
      continue
    }
    result.push(token)
  }

  return result.join(' ').trim()
}

export function normalizeForTeacherSearch(value: string | null | undefined) {
  return normalizeSearchQuery(value).replace(/\s+/g, '')
}
