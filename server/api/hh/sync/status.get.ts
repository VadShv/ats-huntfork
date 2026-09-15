/**
 * GET /api/hh/sync/status
 *
 * Overview of two-way sync status for the current org.
 */
import { and, eq, isNull, sql } from 'drizzle-orm'
import { hhNegotiation, hhSyncQueue, hhVacancyLink } from '../../../database/schema'

export default defineEventHandler(async (event) => {
  const { session } = await requirePermission(event, { hhNegotiation: ['read'] })
  const orgId = session.activeOrganizationId

  const pending = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(hhSyncQueue)
    .where(and(eq(hhSyncQueue.organizationId, orgId), eq(hhSyncQueue.status, 'pending')))

  const failed = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(hhSyncQueue)
    .where(and(eq(hhSyncQueue.organizationId, orgId), eq(hhSyncQueue.status, 'failed')))

  const synced = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(hhSyncQueue)
    .where(and(eq(hhSyncQueue.organizationId, orgId), eq(hhSyncQueue.status, 'synced')))

  const twoWayLinks = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(hhVacancyLink)
    .where(and(
      eq(hhVacancyLink.organizationId, orgId),
      eq(hhVacancyLink.twoWaySyncEnabled, true),
    ))

  return {
    pending: pending[0]?.count ?? 0,
    failed: failed[0]?.count ?? 0,
    synced: synced[0]?.count ?? 0,
    twoWayLinks: twoWayLinks[0]?.count ?? 0,
  }
})
