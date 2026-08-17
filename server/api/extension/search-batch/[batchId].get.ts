/**
 * GET /api/extension/search-batch/:batchId
 *
 * Получение статуса и результатов асинхронного батча прогона.
 *
 * Возвращает:
 *   { status: 'running'|'complete'|'error', total, done, results }
 *
 * results содержит только завершённые запросы. Расширение опрашивает
 * этот endpoint до status === 'complete' или 'error'.
 */
import { z } from 'zod'
import { getBatchState } from '../../../utils/search/batchStore'

const paramsSchema = z.object({ batchId: z.string().min(1).max(64) })

export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { candidate: ['read'] })

  const { batchId } = await getValidatedRouterParams(event, paramsSchema.parse)

  const state = getBatchState(batchId)
  // Чужие батчи не отдаём: для другой организации батч «не существует»
  const orgId = session.session.activeOrganizationId
  if (!state || state.orgId !== orgId) {
    throw createError({ statusCode: 404, statusMessage: 'Батч не найден или истёк' })
  }

  return {
    ok: true as const,
    batchId: state.id,
    status: state.status,
    total: state.total,
    done: state.done,
    results: state.results,
  }
})
