/**
 * Детерминированная сборка строки запроса по гипотезе поиска.
 * docs/tz-search-map-v2.md §6.3 — запросы собираются кодом, а не моделью.
 *
 * Используется и на клиенте (кнопка «Собрать» в SegmentDrawer), и на сервере
 * (fallback, когда модель не вернула queryString). Единая логика → строка на экране
 * всегда совпадает с тем, что уйдёт в канал.
 *
 * Язык запроса определяется каналом:
 *  - xray    — канал с targetSite (Google x-ray): кавычки, OR, минус для исключений.
 *              `site:` НЕ добавляется здесь — его подставляет buildQueryUrl / drawer.
 *  - boolean — hh, LinkedIn, GitHub, Habr и любой канал с подсказкой про AND/OR/NOT.
 *  - plain   — Telegram, рефералы: человекочитаемая строка для сообщения/поиска по чату.
 */

export type QueryLanguage = 'boolean' | 'xray' | 'plain'

export interface QueryChannelLike {
  code?: string | null
  targetSite?: string | null
  queryLanguageHint?: string | null
}

export interface QuerySegmentLike {
  titles?: string[] | null
  keywords?: string[] | null
  geo?: string[] | null
}

const BOOLEAN_CHANNEL_CODES = new Set(['hh', 'linkedin', 'github', 'habr'])

/** Сколько элементов берём в запрос — длинные запросы режут пул и не читаются. */
export const QUERY_LIMITS = { titles: 6, keywords: 6, geo: 3, exclusions: 5 } as const

/** Исключение пригодно для NOT только если это короткая фраза (название компании/тайтл), а не предложение. */
export const MAX_EXCLUSION_WORDS = 3

export function detectQueryLanguage(channel?: QueryChannelLike | null): QueryLanguage {
  if (!channel) return 'boolean'
  if (channel.targetSite) return 'xray'
  if (channel.code && BOOLEAN_CHANNEL_CODES.has(channel.code)) return 'boolean'
  if (channel.queryLanguageHint && /\b(AND|OR|NOT)\b/.test(channel.queryLanguageHint)) return 'boolean'
  return 'plain'
}

function clean(list?: string[] | null, limit = 10): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of list ?? []) {
    const v = String(raw ?? '').trim().replace(/\s+/g, ' ')
    if (!v) continue
    const key = v.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(v)
    if (out.length >= limit) break
  }
  return out
}

/** Кавычки нужны только для фраз из нескольких слов или со спецсимволами (C++, 1С:УХ). */
function quote(term: string): string {
  const needs = /\s|[:+#./-]/.test(term)
  return needs ? `"${term.replace(/"/g, '')}"` : term
}

function group(terms: string[], joiner: string): string {
  if (terms.length === 1) return quote(terms[0]!)
  return `(${terms.map(quote).join(` ${joiner} `)})`
}

export function usableExclusions(exclusions?: string[] | null): string[] {
  return clean(exclusions, 50)
    .filter(e => e.split(/\s+/).length <= MAX_EXCLUSION_WORDS)
    .slice(0, QUERY_LIMITS.exclusions)
}

export function buildQueryString(
  segment: QuerySegmentLike,
  channel?: QueryChannelLike | null,
  exclusions?: string[] | null,
): string {
  const titles = clean(segment.titles, QUERY_LIMITS.titles)
  const keywords = clean(segment.keywords, QUERY_LIMITS.keywords)
  const geo = clean(segment.geo, QUERY_LIMITS.geo)
  const excl = usableExclusions(exclusions)
  const lang = detectQueryLanguage(channel)

  if (lang === 'plain') {
    const parts: string[] = []
    if (titles.length) parts.push(titles.join(' / '))
    if (keywords.length) parts.push(keywords.join(', '))
    if (geo.length) parts.push(geo.join(', '))
    return parts.join(' — ')
  }

  if (lang === 'xray') {
    // Google: пробел = AND, OR внутри скобок, минус — исключение. Гео — отдельной фразой.
    const parts: string[] = []
    if (titles.length) parts.push(group(titles, 'OR'))
    if (keywords.length) parts.push(group(keywords, 'OR'))
    if (geo.length) parts.push(geo.length === 1 ? quote(geo[0]!) : group(geo, 'OR'))
    for (const e of excl) parts.push(`-${quote(e)}`)
    return parts.join(' ')
  }

  // boolean (hh, LinkedIn, GitHub, Habr)
  const parts: string[] = []
  if (titles.length) parts.push(group(titles, 'OR'))
  if (keywords.length) parts.push(group(keywords, 'OR'))
  if (geo.length) parts.push(group(geo, 'OR'))
  let query = parts.join(' AND ')
  if (excl.length) query += ` NOT ${group(excl, 'OR')}`
  return query
}
