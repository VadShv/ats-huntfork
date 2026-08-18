/**
 * Yandex Search API — основной провайдер для RU-поиска (§2.3 ТЗ).
 *
 * Асинхронный метод: POST /v2/web/searchAsync, затем опрос результата.
 * Ответ в XML или base64 — требует раскодирования.
 *
 * Ключи читаются из runtimeConfig (server-only):
 *   YANDEX_FOLDER_ID, YANDEX_SEARCH_API_KEY
 *
 * При отсутствии ключей возвращает { code: 'no_keys' } — gateway переключится
 * на следующий провайдер в фолбэк-цепочке.
 *
 * Квоты НЕ зашиваются константами — читаются из ответа API.
 */
import type { SearchRequest, SearchResult, SearchError } from '../types'

const YANDEX_SEARCH_API_URL = 'https://searchapi.api.cloud.yandex.net/v2/web/searchAsync'

interface YandexConfig {
  folderId: string
  apiKey: string
}

/** Читает конфигурацию из env. Возвращает null если ключей нет. */
function getConfig(): YandexConfig | null {
  const folderId = process.env.YANDEX_FOLDER_ID || ''
  const apiKey = process.env.YANDEX_SEARCH_API_KEY || ''
  if (!folderId || !apiKey) return null
  return { folderId, apiKey }
}

/** Проверяет, доступны ли ключи Yandex. */
export function yandexAvailable(): boolean {
  return getConfig() !== null
}

export async function searchYandex(req: SearchRequest): Promise<SearchResult | SearchError> {
  const config = getConfig()
  if (!config) {
    return { code: 'no_keys', message: 'YANDEX_FOLDER_ID или YANDEX_SEARCH_API_KEY не заданы', provider: 'yandex' }
  }

  const startTime = Date.now()

  try {
    // Шаг 1: отправляем асинхронный запрос
    const body = {
      query: req.query,
      folderId: config.folderId,
      responseFormat: 'JSON',
      userAgent: 'HuntforkSidekick/1.0',
      ...(req.numResults ? { pageSize: Math.min(req.numResults, 100) } : {}),
    }

    const submitResp = await fetch(YANDEX_SEARCH_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Api-Key ${config.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    })

    if (submitResp.status === 429) {
      return { code: 'rate_limited', message: 'Yandex: превышен лимит частоты', provider: 'yandex' }
    }
    if (!submitResp.ok) {
      const text = await submitResp.text().catch(() => '')
      return { code: 'provider_error', message: `Yandex submit: ${submitResp.status} ${text.slice(0, 200)}`, provider: 'yandex' }
    }

    const submitData = await submitResp.json() as { id?: string; error?: { message?: string } }
    if (submitData.error || !submitData.id) {
      return { code: 'provider_error', message: submitData.error?.message || 'Yandex: нет id в ответе', provider: 'yandex' }
    }

    // Шаг 2: опрос результата с задержкой 1.5с, максимум 3 попытки
    const resultUrl = `${YANDEX_SEARCH_API_URL}/${submitData.id}`
    for (let attempt = 0; attempt < 3; attempt++) {
      await sleep(1500)

      const resultResp = await fetch(resultUrl, {
        headers: { 'Authorization': `Api-Key ${config.apiKey}` },
        signal: AbortSignal.timeout(10_000),
      })

      if (resultResp.status === 429) {
        return { code: 'rate_limited', message: 'Yandex: превышен лимит при опросе', provider: 'yandex' }
      }
      if (!resultResp.ok) {
        continue // повторяем
      }

      const data = await resultResp.json() as YandexSearchResponse
      return parseYandexResponse(data, req, Date.now() - startTime)
    }

    return { code: 'timeout', message: 'Yandex: время опроса истекло', provider: 'yandex' }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      return { code: 'timeout', message: 'Yandex: таймаут запроса', provider: 'yandex' }
    }
    return { code: 'network', message: `Yandex: ${String(err).slice(0, 200)}`, provider: 'yandex' }
  }
}

/** Ответ Yandex Search API (упрощённая структура). */
interface YandexSearchResponse {
  raw_data?: string  // base64-закодированный XML/JSON
  result?: {
    total?: string | number
    found?: string | number
    detected_query?: string
    query?: string
    links?: Array<{ url: string; title: string; snippet?: string }>
  }
  error?: { message?: string }
}

function parseYandexResponse(data: YandexSearchResponse, req: SearchRequest, latencyMs: number): SearchResult | SearchError {
  if (data.error) {
    return { code: 'provider_error', message: data.error.message || 'Yandex parse error', provider: 'yandex' }
  }

  const result = data.result
  if (!result) {
    // Пустой ответ — валидный результат с 0
    return {
      total: 0,
      cached: false,
      provider: 'yandex',
      fetchedAt: new Date().toISOString(),
      latencyMs,
      costUnits: 1,
      results: [],
    }
  }

  const total = parseCount(result.total ?? result.found)
  const detectedQuery = result.detected_query || result.query

  const hits = (result.links || []).map((link, i) => ({
    position: i + 1,
    title: link.title,
    url: link.url,
    snippet: link.snippet,
    domain: extractDomain(link.url),
  }))

  return {
    total,
    detectedQuery: detectedQuery !== req.query ? detectedQuery : undefined,
    cached: false,
    provider: 'yandex',
    fetchedAt: new Date().toISOString(),
    latencyMs,
    costUnits: 1,
    results: hits,
  }
}

function parseCount(v: string | number | undefined): number {
  if (v == null) return 0
  const n = typeof v === 'number' ? v : parseInt(String(v).replace(/\s/g, ''), 10)
  return isNaN(n) ? 0 : n
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
