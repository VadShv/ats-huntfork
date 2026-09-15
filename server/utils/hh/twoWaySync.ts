/**
 * Two-way sync: enqueue outbound changes from Huntfork → hh.ru.
 *
 * When a user moves a candidate to a new stage or sends a message in
 * Huntfork, the change is queued and processed asynchronously by a
 * pg-boss worker. This is more resilient than synchronous push and
 * provides status tracking + retry.
 */
import { and, eq, sql } from 'drizzle-orm'
import {
  hhAccount,
  hhNegotiation,
  hhStageMapping,
  hhSyncQueue,
  hhVacancyLink,
} from '../../database/schema'
import { apiRequest } from './client'
import { getHhSession } from './session'
import { withHhRetry } from './rateLimiter'
import { getBoss } from '../queue/boss'

export const HH_OUTBOUND_SYNC_QUEUE = 'hh-outbound-sync'

/**
 * Enqueue an outbound change to hh.ru.
 * Returns the queue item ID.
 */
export async function enqueueOutboundChange(args: {
  orgId: string
  negotiationId: string
  actionType: string
  payload: Record<string, unknown>
}): Promise<string> {
  const [nego] = await db
    .select()
    .from(hhNegotiation)
    .where(eq(hhNegotiation.id, args.negotiationId))
    .limit(1)
  if (!nego) throw new Error('negotiation not found')

  const [item] = await db
    .insert(hhSyncQueue)
    .values({
      organizationId: args.orgId,
      negotiationId: args.negotiationId,
      hhNegotiationId: nego.hhNegotiationId,
      actionType: args.actionType,
      payload: args.payload,
      status: 'pending',
    })
    .returning()

  if (!item) throw new Error('failed to create sync queue item')

  const boss = await getBoss()
  await boss.send({
    name: HH_OUTBOUND_SYNC_QUEUE,
    data: { queueItemId: item.id },
    options: { retryLimit: 3, retryDelay: 30, retryBackoff: true },
  } as any)

  return item.id
}

/**
 * Process a pending outbound sync item.
 * Called by pg-boss worker.
 */
export async function processOutboundSync(queueItemId: string): Promise<void> {
  const [item] = await db
    .select()
    .from(hhSyncQueue)
    .where(eq(hhSyncQueue.id, queueItemId))
    .limit(1)
  if (!item || item.status !== 'pending') return

  await db
    .update(hhSyncQueue)
    .set({ status: 'processing', attempts: sql`attempts + 1` })
    .where(eq(hhSyncQueue.id, queueItemId))

  try {
    const [nego] = await db
      .select()
      .from(hhNegotiation)
      .where(eq(hhNegotiation.id, item.negotiationId))
      .limit(1)
    if (!nego) throw new Error('negotiation not found')

    const [link] = await db
      .select()
      .from(hhVacancyLink)
      .where(eq(hhVacancyLink.id, nego.hhVacancyLinkId))
      .limit(1)
    if (!link) throw new Error('vacancy link not found')

    const [account] = await db
      .select()
      .from(hhAccount)
      .where(eq(hhAccount.id, link.hhAccountId))
      .limit(1)
    if (!account) throw new Error('hh account not found')

    const hh = await getHhSession(item.organizationId, account.userId)

    const payload = item.payload ?? {}

    switch (item.actionType) {
      case 'move_collection': {
        const collection = payload.collection
        if (!collection) throw new Error('payload.collection is required')
        await withHhRetry(() =>
          apiRequest(
            'PUT',
            `/negotiations/${collection}/${item.hhNegotiationId}`,
            hh.accessToken,
            {},
            hh.config,
          ),
        )
        break
      }
      case 'discard': {
        const messageText = payload.messageText ?? 'Спасибо за интерес, но мы выбрали другого кандидата.'
        await withHhRetry(() =>
          apiRequest(
            'PUT',
            `/negotiations/discard_by_employer/${item.hhNegotiationId}`,
            hh.accessToken,
            { query: { message: messageText } },
            hh.config,
          ),
        )
        break
      }
      case 'send_message': {
        const messageText = payload.messageText
        if (!messageText) throw new Error('payload.messageText is required')
        await withHhRetry(() =>
          apiRequest(
            'POST',
            `/negotiations/${item.hhNegotiationId}/messages`,
            hh.accessToken,
            { body: { message: messageText }, contentType: 'form' },
            hh.config,
          ),
        )
        break
      }
      default:
        throw new Error(`Unknown actionType: ${item.actionType}`)
    }

    await db
      .update(hhSyncQueue)
      .set({ status: 'synced', processedAt: new Date() })
      .where(eq(hhSyncQueue.id, queueItemId))

    await db
      .update(hhNegotiation)
      .set({
        lastOutboundSyncAt: new Date(),
        lastOutboundSyncStatus: 'synced',
        outboundSyncError: null,
        syncDirection: 'bidirectional',
      })
      .where(eq(hhNegotiation.id, item.negotiationId))
  }
  catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)

    await db
      .update(hhSyncQueue)
      .set({ status: 'failed', lastError: errorMsg })
      .where(eq(hhSyncQueue.id, queueItemId))

    await db
      .update(hhNegotiation)
      .set({
        lastOutboundSyncStatus: 'failed',
        outboundSyncError: errorMsg,
      })
      .where(eq(hhNegotiation.id, item.negotiationId))
  }
}

/**
 * Map local pipeline stage → hh.ru collection via hh_stage_mapping.
 */
export async function mapStageToCollection(stageId: string, orgId: string): Promise<string | null> {
  const rows = await db
    .select({ hhCollection: hhStageMapping.hhCollection })
    .from(hhStageMapping)
    .where(and(
      eq(hhStageMapping.organizationId, orgId),
      eq(hhStageMapping.pipelineStageId, stageId),
    ))
    .limit(1)
  return rows[0]?.hhCollection ?? null
}

/**
 * Map hh.ru collection → local pipeline stage via hh_stage_mapping.
 */
export async function mapCollectionToStage(hhCollection: string, orgId: string): Promise<string | null> {
  const rows = await db
    .select({ stageId: hhStageMapping.pipelineStageId })
    .from(hhStageMapping)
    .where(and(
      eq(hhStageMapping.organizationId, orgId),
      eq(hhStageMapping.hhCollection, hhCollection),
    ))
    .limit(1)
  return rows[0]?.stageId ?? null
}

/**
 * Retry a failed sync queue item.
 */
export async function retrySyncQueueItem(queueItemId: string, orgId: string): Promise<boolean> {
  const [item] = await db
    .select()
    .from(hhSyncQueue)
    .where(and(eq(hhSyncQueue.id, queueItemId), eq(hhSyncQueue.organizationId, orgId)))
    .limit(1)
  if (!item || item.status !== 'failed') return false

  await db
    .update(hhSyncQueue)
    .set({ status: 'pending', lastError: null })
    .where(eq(hhSyncQueue.id, queueItemId))

  const boss = await getBoss()
  await boss.send({
    name: HH_OUTBOUND_SYNC_QUEUE,
    data: { queueItemId },
    options: { retryLimit: 3, retryDelay: 30, retryBackoff: true },
  } as any)

  return true
}
