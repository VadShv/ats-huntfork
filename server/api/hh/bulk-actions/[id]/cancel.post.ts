/**
 * POST /api/hh/bulk-actions/:id/cancel
 *
 * Cancel a pending or running bulk action.
 */
import { cancelBulkAction } from '../../../../utils/hh/bulkActions'

export default defineEventHandler(async (event) => {
  const { session } = await requirePermission(event, { hhBulkAction: ['execute'] })
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Не указан ID' })
  }

  const cancelled = await cancelBulkAction(id, session.activeOrganizationId)
  if (!cancelled) {
    throw createError({ statusCode: 404, statusMessage: 'Действие не найдено или уже завершено' })
  }

  return { success: true }
})
