/**
 * GET /api/hh/bulk-actions
 *
 * List bulk actions for the current org.
 */
import { eq, desc } from 'drizzle-orm'
import { hhBulkAction } from '../../../database/schema'

export default defineEventHandler(async (event) => {
  const { session } = await requirePermission(event, { hhBulkAction: ['execute'] })

  const actions = await db
    .select()
    .from(hhBulkAction)
    .where(eq(hhBulkAction.organizationId, session.activeOrganizationId))
    .orderBy(desc(hhBulkAction.createdAt))
    .limit(50)

  return actions
})
