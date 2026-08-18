/**
 * POST /api/extension/search-run
 *
 * Прогон одного X-Ray-запроса через поисковый провайдер.
 * Возвращает единый нормализованный контракт SearchResult | SearchError.
 *
 * Body: {
 *   query: string (1..2000),
 *   engine: 'google' | 'yandex',
 *   jobId?: string,
 *   forceRefresh?: boolean
 * }
 *
 * Ответ: JSON SearchResult (total, provider, cached, ...) или SearchError.
 *
 * Rate limit: 60 запросов/мин на пользователя (§5.1 ТЗ).
 * При отсутствии API-ключей — мок-режим с правдоподобными данными.
 * Отказ поиска не ломает карту — расширение показывает состояние ошибки.
 */
import { z } from 'zod'
import { createRateLimiter } from '../../utils/rateLimit'
import { runSearch } from '../../utils/search/gateway'
import { cacheKey } from '../../utils/search/normalize'
import { cacheGet, cacheInvalidate } from '../../utils/search/cache'
import { isSearchError } from '../../utils/search/types'
import type { SearchRequest } from '../../utils/search/types'

const limiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 60,
  message: 'Слишком много поисковых запросов. Подождите минуту',
})

const bodySchema = z.object({
  query: z.string().min(1).max(2000),
  engine: z.enum(['google', 'yandex']).default('google'),
  jobId: z.string().max(64).optional(),
  forceRefresh: z.boolean().default(false),
})

export default defineEventHandler(async (event) => {
  await limiter(event)

  const session = await requirePermission(event, { candidate: ['read'] })
  const orgId = session.session.activeOrganizationId

  const body = await readValidatedBody(event, bodySchema.parse)

  const req: SearchRequest = {
    query: body.query,
    engine: body.engine,
    jobId: body.jobId,
    orgId,
    forceRefresh: body.forceRefresh,
    numResults: 10,
  }

  const outcome = await runSearch(req)

  if (isSearchError(outcome)) {
    setResponseStatus(event, 503)
    return {
      ok: false as const,
      error: outcome,
    }
  }

  return {
    ok: true as const,
    result: outcome,
    cacheKey: cacheKey(req),
  }
})
