/**
 * POST /api/extension/search-batch
 *
 * Массовый прогон X-Ray-запросов карты поиска.
 *
 * Body: {
 *   queries: Array<{ id: string, query: string, engine: 'google'|'yandex' }>,
 *   jobId: string
 * }
 *
 * Лимит: не более 25 запросов на карту (§6.3 ТЗ).
 * Если queries.length ≤ 5 — синхронный режим: выполняет все запросы
 * с задержкой 200мс между ними, возвращает массив результатов.
 * Если > 5 — асинхронный режим: возвращает batchId, результаты тянутся
 * через GET /api/extension/search-batch/:batchId.
 *
 * Rate limit: 60 запросов/мин на пользователя (общий с search-run).
 */
import { z } from 'zod'
import { createRateLimiter } from '../../utils/rateLimit'
import { runSearch } from '../../utils/search/gateway'
import { batchStore, type BatchState } from '../../utils/search/batchStore'
import { isSearchError } from '../../utils/search/types'
import type { SearchRequest, SearchOutcome } from '../../utils/search/types'

const limiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 60,
  message: 'Слишком много поисковых запросов. Подождите минуту',
})

const queryItemSchema = z.object({
  id: z.string().min(1).max(64),
  query: z.string().min(1).max(2000),
  engine: z.enum(['google', 'yandex']).default('google'),
})

const bodySchema = z.object({
  queries: z.array(queryItemSchema).min(1).max(25),
  jobId: z.string().min(1).max(64),
})

export default defineEventHandler(async (event) => {
  await limiter(event)

  const session = await requirePermission(event, { candidate: ['read'] })
  const orgId = session.session.activeOrganizationId

  const body = await readValidatedBody(event, bodySchema.parse)

  const { queries, jobId } = body

  // Синхронный режим: ≤ 5 запросов
  if (queries.length <= 5) {
    const results: Record<string, SearchOutcome> = {}

    for (let i = 0; i < queries.length; i++) {
      const q = queries[i]!
      const req: SearchRequest = {
        query: q.query,
        engine: q.engine,
        jobId,
        orgId,
        numResults: 10,
      }

      results[q.id] = await runSearch(req)

      // Задержка 200мс между запросами
      if (i < queries.length - 1) {
        await new Promise(r => setTimeout(r, 200))
      }
    }

    return {
      ok: true as const,
      mode: 'sync' as const,
      results,
    }
  }

  // Асинхронный режим: > 5 запросов
  const batchId = `batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const batchState: BatchState = {
    id: batchId,
    orgId,
    total: queries.length,
    results: {},
    done: 0,
    status: 'running',
    startedAt: Date.now(),
  }
  batchStore.set(batchId, batchState)

  // Запускаем в фоне, не блокируя ответ
  runBatchInBackground(batchId, queries, jobId, orgId).catch(err => {
    console.error(`[search-batch] background error:`, err)
    const state = batchStore.get(batchId)
    if (state) state.status = 'error'
  })

  return {
    ok: true as const,
    mode: 'async' as const,
    batchId,
    total: queries.length,
  }
})

/** Фоновая обработка батча. */
async function runBatchInBackground(
  batchId: string,
  queries: Array<{ id: string; query: string; engine: 'google' | 'yandex' }>,
  jobId: string,
  orgId: string,
): Promise<void> {
  const state = batchStore.get(batchId)
  if (!state) return

  for (let i = 0; i < queries.length; i++) {
    // Проверяем, не истёк ли батч (10 минут максимум)
    if (Date.now() - state.startedAt > 10 * 60 * 1000) {
      state.status = 'error'
      break
    }

    const q = queries[i]!
    const req: SearchRequest = {
      query: q.query,
      engine: q.engine,
      jobId,
      orgId,
      numResults: 10,
    }

    try {
      state.results[q.id] = await runSearch(req)
    } catch (err) {
      state.results[q.id] = {
        code: 'network',
        message: String(err).slice(0, 200),
      }
    }

    state.done = i + 1

    // Задержка 200мс между запросами
    if (i < queries.length - 1) {
      await new Promise(r => setTimeout(r, 200))
    }
  }

  state.status = 'complete'

  // Авто-очистка через 10 минут после завершения
  setTimeout(() => {
    batchStore.delete(batchId)
  }, 10 * 60 * 1000).unref()
}
