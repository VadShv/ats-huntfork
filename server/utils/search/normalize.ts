/**
 * Нормализация поискового запроса перед хешированием (§4.1 ТЗ).
 *
 * Без нормализации две логически идентичные строки дают разные ключи кеша:
 *   "site:linkedin.com/in Go" и "site:linkedin.com/in  Go" — один запрос.
 *
 * Нормализация:
 *  1. Приведение кавычек к прямым "
 *  2. Тире → пробел (поисковики путают с минусом)
 *  3. Множественные пробелы → один
 *  4. Сортировка терминов внутри OR-групп
 *  5. Trim
 */
import { createHash } from 'node:crypto'
import type { SearchRequest, CacheTtlType } from './types'

/** Нормализует текст поисковой строки. */
export function normalizeQuery(text: string): string {
  if (!text) return ''
  return text
    .replace(/[«»“”‘’„‚]/g, '"')
    .replace(/[—–]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Сортировка терминов внутри OR-групп для стабильного ключа кеша.
 * ("Go" OR "Golang" OR "Python") → ("Golang" OR "Go" OR "Python")
 *
 * Ищет группы в скобках с OR, сортирует альтернативы по алфавиту.
 */
export function sortOrGroups(text: string): string {
  return text.replace(/\(([^)]+)\)/g, (_, inner: string) => {
    if (!/\bOR\b/i.test(inner)) return `(${inner})`
    const parts = inner.split(/\s+OR\s+/i).map(s => s.trim())
    parts.sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }))
    return `(${parts.join(' OR ')})`
  })
}

/**
 * Полная нормализация: кавычки + тире + пробелы + сортировка OR-групп + trim.
 */
export function normalizeForCache(text: string): string {
  return sortOrGroups(normalizeQuery(text))
}

/** Ключ кеша: sha256(нормализованный_запрос + engine + гео + язык + число). */
export function cacheKey(req: SearchRequest): string {
  const normalized = normalizeForCache(req.query)
  const parts = [
    normalized,
    req.engine,
    req.geo || '',
    req.lang || '',
    String(req.numResults || 10),
  ].join('|')
  return createHash('sha256').update(parts).digest('hex').slice(0, 32)
}

/** TTL по типам данных (§4.2 ТЗ), в миллисекундах. */
export const CACHE_TTL: Record<CacheTtlType, number> = {
  xray: 24 * 60 * 60 * 1000,        // 24 часа — выдача меняется медленно
  company: 30 * 24 * 60 * 60 * 1000, // 30 дней — факт стабильный
  digital_trace: 7 * 24 * 60 * 60 * 1000, // 7 дней
  generative: 14 * 24 * 60 * 60 * 1000,   // 14 дней
  empty: 6 * 60 * 60 * 1000,        // 6 часов — короче, возможна ошибка в запросе
}

/** Определяет тип TTL по результату. */
export function ttlTypeForResult(total: number): CacheTtlType {
  return total === 0 ? 'empty' : 'xray'
}
