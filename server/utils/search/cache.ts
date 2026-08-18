/**
 * In-memory кеш поисковых результатов (§4 ТЗ).
 *
 * Map<key, { result, expiresAt }> с TTL по типам данных.
 *
 * Мягкое устаревание (§4.3): просроченный результат отдаётся немедленно
 * с пометкой stale: true, обновление идёт в фоне.
 *
 * Кеш общий на процесс (не на пользователя). При горизонтальном масштабировании
 * следует перейти на Redis — аналогично rateLimit.ts.
 */
import type { SearchResult } from './types'
import { CACHE_TTL, ttlTypeForResult } from './normalize'

interface CacheEntry {
  result: SearchResult
  expiresAt: number
  /** Время последнего доступа — для LRU-eviction при нехватке памяти. */
  lastAccessed: number
}

const store = new Map<string, CacheEntry>()

/** Максимум записей в кеше — защита от утечки памяти. */
const MAX_ENTRIES = 5000

/** Возвращает результат из кеша. Если просрочен — возвращает с stale: true. */
export function cacheGet(key: string): SearchResult | null {
  const entry = store.get(key)
  if (!entry) return null

  const now = Date.now()
  entry.lastAccessed = now

  // Просрочен — отдаём с пометкой stale, обновление идёт в фоне
  if (now > entry.expiresAt) {
    return { ...entry.result, stale: true, cached: true }
  }

  return { ...entry.result, cached: true }
}

/** Записывает результат в кеш с TTL по типу. */
export function cacheSet(key: string, result: SearchResult): void {
  const ttl = CACHE_TTL[ttlTypeForResult(result.total)]
  const now = Date.now()

  // LRU-eviction при достижении лимита
  if (store.size >= MAX_ENTRIES) {
    evictOldest()
  }

  store.set(key, {
    result: { ...result, cached: false }, // в кеше храним без cached: true
    expiresAt: now + ttl,
    lastAccessed: now,
  })
}

/** Принудительное обновление — удаляет запись (для кнопки «Обновить»). */
export function cacheInvalidate(key: string): void {
  store.delete(key)
}

/** Кеш-хит виден в статистике. */
export function cacheStats(): { size: number; maxEntries: number } {
  return { size: store.size, maxEntries: MAX_ENTRIES }
}

/** Очищает просроченные записи (lazy GC — вызывается при каждом get). */
function gc(): void {
  const now = Date.now()
  for (const [key, entry] of store) {
    // Удаляем записи, просроченные более чем на 2× TTL (не отдавать даже stale)
    const maxAge = entry.expiresAt + 24 * 60 * 60 * 1000
    if (now > maxAge) {
      store.delete(key)
    }
  }
}

/** Удаляет самую старую по lastAccessed запись. */
function evictOldest(): void {
  let oldestKey: string | null = null
  let oldestTime = Infinity
  for (const [key, entry] of store) {
    if (entry.lastAccessed < oldestTime) {
      oldestTime = entry.lastAccessed
      oldestKey = key
    }
  }
  if (oldestKey) store.delete(oldestKey)
}

// Запускаем GC при каждом get — дёшево, O(n) но n ограничен MAX_ENTRIES
const _origGet = cacheGet
export function cacheGetWithGc(key: string): SearchResult | null {
  if (store.size > 1000) gc()
  return _origGet(key)
}
