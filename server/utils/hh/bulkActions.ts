/**
 * Bulk actions on hh.ru negotiations.
 *
 * Processes mass operations (invite, discard, move collection, send message)
 * asynchronously via pg-boss with rate limiting and per-item error tracking.
 */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { hhBulkAction, hhNegotiation, hhVacancyLink } from '../../database/schema'
import { apiRequest } from './client'
import { getHhSession } from './session'
import { withHhRateLimit, withHhRetry } from './rateLimiter'
import type { HhSession } from './session'

export const HH_BULK_ACTION_QUEUE = 'hh-bulk-action'

/**
 * Resolve filter → list of hh.ru negotiation IDs.
 * Used when user provides a filter instead of explicit IDs.
 */
export async function resolveBulkTargets(args: {
  orgId: string
  filter: {
    vacancyId?: string
    collections?: string[]
    areaIds?: string[]
    dateFrom?: string
    dateTo?: string
  }
}): Promise<string[]> {
  const conditions = [eq(hhNegotiation.organizationId, args.orgId)]

  if (args.filter.vacancyId) {
    const links = await db
      .select({ id: hhVacancyLink.id })
      .from(hhVacancyLink)
      .where(and(
        eq(hhVacancyLink.organizationId, args.orgId),
        eq(hhVacancyLink.jobId, args.filter.vacancyId),
      ))
    if (links.length === 0) return []
    conditions.push(inArray(hhNegotiation.hhVacancyLinkId, links.map(l => l.id)))
  }

  if (args.filter.collections?.length) {
    conditions.push(inArray(hhNegotiation.hhCollection, args.filter.collections))
  }

  const rows = await db
    .select({ hhId: hhNegotiation.hhNegotiationId })
    .from(hhNegotiation)
    .where(and(...conditions))

  return rows.map(r => r.hhId)
}

/**
 * Execute a single bulk action item against hh.ru.
 */
export async function executeBulkItem(args: {
  session: HhSession
  actionType: string
  targetType: string
  itemId: string
  params: { collection?: string, messageText?: string }
}): Promise<{ success: boolean, error?: string }> {
  const { session, actionType, itemId, params } = args
  const nid = itemId

  try {
    if (actionType === 'invite') {
      const res = await apiRequest(
        'PUT',
        `/negotiations/consider/${nid}`,
        session.accessToken,
        {},
        session.config,
      )
      return { success: res.status < 400 }
    }

    if (actionType === 'discard') {
      const message = params.messageText ?? 'Спасибо за интерес, но мы выбрали другого кандидата.'
      const res = await apiRequest(
        'PUT',
        `/negotiations/discard_by_employer/${nid}`,
        session.accessToken,
        { query: { message } },
        session.config,
      )
      return { success: res.status < 400 }
    }

    if (actionType === 'move_collection') {
      const collection = params.collection
      if (!collection) return { success: false, error: 'params.collection is required' }
      const res = await apiRequest(
        'PUT',
        `/negotiations/${collection}/${nid}`,
        session.accessToken,
        {},
        session.config,
      )
      return { success: res.status < 400 }
    }

    if (actionType === 'send_message') {
      const messageText = params.messageText
      if (!messageText) return { success: false, error: 'params.messageText is required' }
      const res = await apiRequest(
        'POST',
        `/negotiations/${nid}/messages`,
        session.accessToken,
        { body: { message: messageText }, contentType: 'form' },
        session.config,
      )
      return { success: res.status < 400 }
    }

    return { success: false, error: `Unknown actionType: ${actionType}` }
  }
  catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Main batch processor — called by pg-boss worker.
 * Processes items sequentially with rate limiting.
 */
export async function processBulkAction(bulkActionId: string): Promise<void> {
  const [action] = await db
    .select()
    .from(hhBulkAction)
    .where(eq(hhBulkAction.id, bulkActionId))
    .limit(1)
  if (!action || action.status !== 'pending') return

  await db
    .update(hhBulkAction)
    .set({ status: 'running', startedAt: new Date() })
    .where(eq(hhBulkAction.id, bulkActionId))

  const hh = await getHhSession(action.organizationId, action.initiatedByUserId!)

  let itemIds = action.itemIds ?? []
  if (itemIds.length === 0 && action.filter) {
    itemIds = await resolveBulkTargets({ orgId: action.organizationId, filter: action.filter })
  }

  await db
    .update(hhBulkAction)
    .set({ totalItems: itemIds.length })
    .where(eq(hhBulkAction.id, bulkActionId))

  const results: Array<{ itemId: string, status: 'success' | 'failed', error?: string }> = []

  for (const itemId of itemIds) {
    try {
      const result = await withHhRateLimit(() =>
        withHhRetry(() => executeBulkItem({
          session: hh,
          actionType: action.actionType,
          targetType: action.targetType,
          itemId,
          params: action.params ?? {},
        })),
        'bulk',
      )

      results.push({ itemId, status: result.success ? 'success' : 'failed', error: result.error })

      await db
        .update(hhBulkAction)
        .set({
          processedItems: sql`processed_items + 1`,
          succeededItems: result.success ? sql`succeeded_items + 1` : sql`succeeded_items`,
          failedItems: result.success ? sql`failed_items` : sql`failed_items + 1`,
        })
        .where(eq(hhBulkAction.id, bulkActionId))
    }
    catch (err) {
      results.push({ itemId, status: 'failed', error: String(err) })
      await db
        .update(hhBulkAction)
        .set({
          processedItems: sql`processed_items + 1`,
          failedItems: sql`failed_items + 1`,
        })
        .where(eq(hhBulkAction.id, bulkActionId))
    }
  }

  await db
    .update(hhBulkAction)
    .set({
      status: 'completed',
      completedAt: new Date(),
      results,
    })
    .where(eq(hhBulkAction.id, bulkActionId))
}

/**
 * Cancel a pending/running bulk action.
 */
export async function cancelBulkAction(bulkActionId: string, orgId: string): Promise<boolean> {
  const [action] = await db
    .select()
    .from(hhBulkAction)
    .where(and(eq(hhBulkAction.id, bulkActionId), eq(hhBulkAction.organizationId, orgId)))
    .limit(1)
  if (!action) return false
  if (action.status === 'completed' || action.status === 'cancelled') return false

  await db
    .update(hhBulkAction)
    .set({ status: 'cancelled', completedAt: new Date() })
    .where(eq(hhBulkAction.id, bulkActionId))
  return true
}
