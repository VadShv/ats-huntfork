/**
 * Bright Data SERP — основной провайдер для Google-выдачи (§2.3 ТЗ).
 *
 * Единая точка: POST https://api.brightdata.com/request
 * Поддерживает engine=yandex для RU-запросов (фолбэк от Yandex API).
 *
 * Ключи: BRIGHTDATA_TOKEN, BRIGHTDATA_ZONE из env.
 * При отсутствии — { code: 'no_keys' }, gateway переключается дальше.
 *
 * Неуспешные запросы не тарифицируются — критично при массовом прогоне.
 */
import type { SearchRequest, SearchResult, SearchError } from '../types'

const BRIGHTDATA_API_URL = 'https://api.brightdata.com/request'

interface BrightDataConfig {
  token: string
  zone: string
}

function getConfig(): BrightDataConfig | null {
  const token = process.env.BRIGHTDATA_TOKEN || ''
  const zone = process.env.BRIGHTDATA_ZONE || 'serp'
  if (!token) return null
  return { token, zone }
}

export function brightdataAvailable(): boolean {
  return getConfig() !== null
}

export async function searchBrightData(req: SearchRequest): Promise<SearchResult | SearchError> {
  const config = getConfig()
  if (!config) {
    return { code: 'no_keys', message: 'BRIGHTDATA_TOKEN не задан', provider: 'brightdata' }
  }

  const startTime = Date.now()

  try {
    // engine выбирается по типу запроса: RU-площадки → yandex, иначе google
    const engine = req.engine === 'yandex' ? 'yandex' : 'google'
    const searchUrl = buildSearchUrl(req, engine)

    const body = {
      zone: config.zone,
      url: searchUrl,
      format: 'json',
    }

    const resp = await fetch(BRIGHTDATA_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.token}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    })

    if (resp.status === 429) {
      return { code: 'rate_limited', message: 'Bright Data: превышен лимит', provider: 'brightdata' }
    }
    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      return { code: 'provider_error', message: `Bright Data: ${resp.status} ${text.slice(0, 200)}`, provider: 'brightdata' }
    }

    const data = await resp.json() as BrightDataResponse
    return parseBrightDataResponse(data, req, Date.now() - startTime)
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      return { code: 'timeout', message: 'Bright Data: таймаут', provider: 'brightdata' }
    }
    return { code: 'network', message: `Bright Data: ${String(err).slice(0, 200)}`, provider: 'brightdata' }
  }
}

function buildSearchUrl(req: SearchRequest, engine: 'google' | 'yandex'): string {
  const encodedQuery = encodeURIComponent(req.query)
  const num = req.numResults || 10

  if (engine === 'yandex') {
    const params = new URLSearchParams({ text: req.query, num: String(num) })
    return `https://yandex.ru/search/?${params.toString()}`
  }

  // Google
  return `https://www.google.com/search?q=${encodedQuery}&num=${num}&brd_json=1`
}

interface BrightDataResponse {
  organic?: Array<{ pos: number; title: string; link: string; desc?: string }>
  results?: Array<{ pos: number; title: string; link: string; desc?: string }>
  total?: number
  search_information?: {
    total_results?: number
    detected_query?: string
    query_displayed?: string
  }
  error?: string
}

function parseBrightDataResponse(data: BrightDataResponse, req: SearchRequest, latencyMs: number): SearchResult | SearchError {
  if (data.error) {
    return { code: 'provider_error', message: data.error, provider: 'brightdata' }
  }

  const total = data.search_information?.total_results
    ?? data.total
    ?? (data.organic || data.results || []).length

  const detectedQuery = data.search_information?.detected_query || data.search_information?.query_displayed

  const organicResults = data.organic || data.results || []
  const hits = organicResults.slice(0, 5).map((r) => ({
    position: r.pos,
    title: r.title,
    url: r.link,
    snippet: r.desc,
    domain: extractDomain(r.link),
  }))

  return {
    total: typeof total === 'string' ? parseCount(total) : total,
    detectedQuery: detectedQuery && detectedQuery !== req.query ? detectedQuery : undefined,
    cached: false,
    provider: 'brightdata',
    fetchedAt: new Date().toISOString(),
    latencyMs,
    costUnits: 1,
    results: hits,
  }
}

function parseCount(v: string): number {
  const n = parseInt(v.replace(/[^0-9]/g, ''), 10)
  return isNaN(n) ? 0 : n
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
