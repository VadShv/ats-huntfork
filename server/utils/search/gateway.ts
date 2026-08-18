/**
 * Search Gateway — единая точка входа для поисковых запросов (§2.3, §3 ТЗ).
 *
 * Фолбэк-цепочка:
 *   RU-площадка (hh.ru, career.habr.com, vc.ru) → Yandex → Bright Data (engine=yandex) → mock
 *   Google X-Ray (site:linkedin.com, site:github.com) → Bright Data (engine=google) → Yandex → mock
 *
 * Правила:
 *  - Проверка кеша перед запросом к провайдеру
 *  - При 'no_keys' → следующий в цепочке
 *  - При 'empty' — НЕ фолбэк (пустая выдача валидна)
 *  - При 'rate_limited' — выдержка с джиттером, затем фолбэк
 *  - При 'timeout'/'network' → следующий в цепочке
 *  - Если все провайдеры вернули 'no_keys' → mock ТОЛЬКО при SEARCH_MOCK=1,
 *    иначе честная ошибка 'no_keys' («поиск не настроен»)
 *  - Принудительное обновление — сброс кеша перед запросом
 *
 * Принцип деградации: отказ поиска НИКОГДА не ломает карту поиска.
 */
import type { SearchRequest, SearchResult, SearchError, SearchOutcome, SearchProvider } from './types'
import { isSearchError } from './types'
import { cacheGet, cacheSet, cacheInvalidate } from './cache'
import { cacheKey } from './normalize'
import { searchYandex } from './providers/yandex'
import { searchBrightData } from './providers/brightdata'
import { searchMock } from './providers/mock'

/** Определяет, RU-площадка ли это (фолбэк-цепочка §2.3). */
function isRuQuery(query: string): boolean {
  const ruPatterns = [
    /hh\.ru/i, /career\.habr\.com/i, /vc\.ru/i, /habr\.com/i,
    /moikrug\.ru/i, /freelance\.ru/i,
  ]
  return ruPatterns.some(p => p.test(query))
}

/** Строит цепочку провайдеров по типу запроса. */
function buildChain(req: SearchRequest): Array<'yandex' | 'brightdata'> {
  const ruQuery = isRuQuery(req.query)

  if (ruQuery || req.engine === 'yandex') {
    // RU: Yandex → Bright Data (engine=yandex)
    return ['yandex', 'brightdata']
  }

  // Google X-Ray: Bright Data (engine=google) → Yandex
  return ['brightdata', 'yandex']
}

/** Вызывает конкретный провайдер. */
async function callProvider(name: 'yandex' | 'brightdata', req: SearchRequest): Promise<SearchOutcome> {
  if (name === 'yandex') return searchYandex(req)
  return searchBrightData(req)
}

/** Выдержка с джиттером при 429 (§5.2 ТЗ). */
function backoffWithJitter(attempt: number): Promise<void> {
  const base = Math.min(1000 * Math.pow(2, attempt), 4000)
  const jitter = Math.random() * 500
  return new Promise(resolve => setTimeout(resolve, base + jitter))
}

/**
 * Главная функция: выполняет поиск с кешем и фолбэком.
 * Никогда не бросает — возвращает SearchOutcome.
 */
export async function runSearch(req: SearchRequest): Promise<SearchOutcome> {
  const key = cacheKey(req)

  // Принудительное обновление
  if (req.forceRefresh) {
    cacheInvalidate(key)
  } else {
    // Проверка кеша
    const cached = cacheGet(key)
    if (cached) {
      return cached
    }
  }

  const chain = buildChain(req)
  const errors: SearchError[] = []

  for (let i = 0; i < chain.length; i++) {
    const providerName = chain[i]!

    // При 429 — выдержка перед повтором/фолбэком
    if (errors.some(e => e.code === 'rate_limited')) {
      await backoffWithJitter(i)
    }

    const outcome = await callProvider(providerName, req)

    // Успех
    if (!isSearchError(outcome)) {
      cacheSet(key, outcome)
      return outcome
    }

    // Пустая выдача — валидный результат, НЕ фолбэк
    if (outcome.code === 'empty') {
      // Пустая выдача — это total: 0
      const emptyResult: SearchResult = {
        total: 0,
        cached: false,
        provider: providerName,
        fetchedAt: new Date().toISOString(),
        latencyMs: 0,
        costUnits: 0,
        results: [],
      }
      cacheSet(key, emptyResult)
      return emptyResult
    }

    errors.push(outcome)

    // no_keys → следующий провайдер
    if (outcome.code === 'no_keys') continue

    // rate_limited → выдержка уже была, пробуем следующий
    if (outcome.code === 'rate_limited') continue

    // timeout / network → следующий
    if (outcome.code === 'timeout' || outcome.code === 'network') continue

    // provider_error → следующий
    if (outcome.code === 'provider_error') continue

    // budget_exceeded — не фолбэк, блокируем
    if (outcome.code === 'budget_exceeded') {
      return outcome
    }
  }

  // Все провайдеры в цепочке недоступны (no_keys / timeout / network)
  const allNoKeys = errors.every(e => e.code === 'no_keys')
  if (allNoKeys) {
    // Демо-режим ТОЛЬКО при явном SEARCH_MOCK=1: молчаливый мок в проде
    // выдаёт рекрутёру правдоподобные, но фейковые цифры.
    const config = useRuntimeConfig()
    if (config.searchMock) {
      const mockResult = searchMock(req)
      cacheSet(key, mockResult)
      return mockResult
    }
    return {
      code: 'no_keys',
      message: 'Поиск не настроен: не заданы ключи Yandex Search API / Bright Data',
    }
  }

  // Все провайдеры упали — возвращаем последнюю ошибку
  // Но карта не ломается — расширение показывает «поиск недоступен»
  return errors[errors.length - 1]!
}
