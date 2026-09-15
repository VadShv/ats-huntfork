/**
 * POST /api/hh/sync/queue/:id/retry
 *
 * Retry a failed outbound sync queue item.
 */
import { retrySyncQueueItem } from '../../../../../utils/hh/twoWaySync'

export default defineEventHandler(async (event) => {
  const { session } = await requirePermission(event, { hhNegotiation: ['sync'] })
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Не указан ID' })
  }

  const retried = await retrySyncQueueItem(id, session.activeOrganizationId)
  if (!retried) {
    throw createError({ statusCode: 404, statusMessage: 'Элемент не найден или не в статусе failed' })
  }

  return { success: true }
})
