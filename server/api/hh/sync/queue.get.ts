/**
 * GET /api/hh/sync/queue
 *
 * List outbound sync queue items for the current org.
 */
import { and, eq, desc } from 'drizzle-orm'
import { hhSyncQueue } from '../../../database/schema'

export default defineEventHandler(async (event) => {
  const { session } = await requirePermission(event, { hhNegotiation: ['read'] })
  const orgId = session.activeOrganizationId

  const query = getQuery(event)
  const status = query.status as string | undefined

  const conditions = [eq(hhSyncQueue.organizationId, orgId)]
  if (status) {
    conditions.push(eq(hhSyncQueue.status, status))
  }

  const items = await db
    .select()
    .from(hhSyncQueue)
    .where(and(...conditions))
    .orderBy(desc(hhSyncQueue.createdAt))
    .limit(100)

  return items
})
