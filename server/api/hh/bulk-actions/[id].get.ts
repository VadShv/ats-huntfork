/**
 * GET /api/hh/bulk-actions/:id
 *
 * Get a single bulk action with progress and results.
 */
import { and, eq } from 'drizzle-orm'
import { hhBulkAction } from '../../../database/schema'

export default defineEventHandler(async (event) => {
  const { session } = await requirePermission(event, { hhBulkAction: ['execute'] })
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Не указан ID' })
  }

  const [action] = await db
    .select()
    .from(hhBulkAction)
    .where(and(eq(hhBulkAction.id, id), eq(hhBulkAction.organizationId, session.activeOrganizationId)))
    .limit(1)

  if (!action) {
    throw createError({ statusCode: 404, statusMessage: 'Не найдено' })
  }

  return action
})
