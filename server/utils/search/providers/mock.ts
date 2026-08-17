/**
 * Mock-провайдер — правдоподобные данные при отсутствии API-ключей.
 *
 * Активируется автоматически, когда Yandex/BrightData возвращают 'no_keys',
 * или при явном SEARCH_MOCK=1 в env.
 *
 * Счётчик детерминирован (хеш запроса) — один и тот же запрос всегда даёт
 * тот же результат. Это позволяет демонстрировать UI без реальных ключей.
 */
import type { SearchRequest, SearchResult, SearchProvider } from '../types'

/** Детерминированный псевдослучайный хеш строки → число 0..1. */
function hashToFloat(text: string): number {
  let hash = 0
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0
  }
  // Нормализуем в 0..1
  return Math.abs(hash) / 2147483647
}

/** Оценка числа результатов по типу запроса. */
function estimateTotal(query: string): number {
  const h = hashToFloat(query)

  // Широкие запросы (без site:) — меньше результатов
  const isXray = /\bsite:/.test(query)
  const hasFiletype = /filetype:/.test(query)

  if (hasFiletype) {
    // filetype:pdf — обычно меньше результатов
    return Math.floor(10 + h * 80)
  }

  if (isXray) {
    // site:linkedin.com/in — X-Ray, 50-400
    return Math.floor(50 + h * 350)
  }

  // Широкий запрос — 10-80
  return Math.floor(10 + h * 70)
}

/** Генерирует правдоподобную задержку 300-800мс. */
function mockLatency(): number {
  return 300 + Math.floor(Math.random() * 500)
}

export function searchMock(req: SearchRequest): SearchResult {
  const total = estimateTotal(req.query)
  const latencyMs = mockLatency()
  const provider: SearchProvider = 'mock'

  // Иногда имитируем detectedQuery (Google исправил опечатку)
  const h = hashToFloat(req.query)
  const detectedQuery = h > 0.85 ? req.query.replace(/SITE:/i, 'site:') : undefined

  // Топ-результаты (правдоподобные домены)
  const results = total > 0 ? generateMockHits(req, Math.min(total, 5)) : []

  return {
    total,
    detectedQuery,
    cached: false,
    stale: false,
    provider,
    fetchedAt: new Date().toISOString(),
    latencyMs,
    costUnits: 0, // мок бесплатен
    results,
  }
}

/** Генерирует правдоподобные хиты выдачи. */
function generateMockHits(req: SearchRequest, count: number): SearchResult['results'] {
  const hits: NonNullable<SearchResult['results']> = []
  const domains = extractDomains(req.query)

  for (let i = 0; i < count; i++) {
    const domain = domains[i % Math.max(domains.length, 1)] || 'example.com'
    hits.push({
      position: i + 1,
      title: `Результат ${i + 1} — ${domain}`,
      url: `https://${domain}/profile/${1000 + i}`,
      snippet: `Профиль кандидата с релевантным опытом. Найден по запросу «${req.query.slice(0, 60)}…».`,
      domain,
    })
  }

  return hits
}

/** Извлекает домены из site: операторов в запросе. */
function extractDomains(query: string): string[] {
  const matches = query.match(/\bsite:(\S+)/gi) || []
  return matches.map(m => m.replace(/\bsite:/i, '').toLowerCase())
}
