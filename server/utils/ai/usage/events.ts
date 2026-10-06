/**
 * Журнал вызовов (docs/tz-ai-usage.md §8.1, блок 6): выборка событий с подписями.
 */
import { and, desc, eq, lt, or, type SQL } from 'drizzle-orm'
import { aiUsageEvent } from '../../../database/schema'
import { aiFeatureLabel, aiOperationLabel } from '../../../../shared/aiUsage/catalog'
import { jobTitles, usageWhere, userNames, type UsageFilters } from './query'

export type AiUsageEventRow = typeof aiUsageEvent.$inferSelect

/** Публичное представление события (без промптов — их в журнале нет by design, §3.5). */
export function presentEvent(r: AiUsageEventRow, names: Map<string, string>, titles: Map<string, string>) {
  return {
    id: r.id,
    createdAt: r.createdAt.toISOString(),
    traceId: r.traceId,
    stepNo: r.stepNo,
    operation: r.operation,
    label: aiOperationLabel(r.operation),
    feature: r.feature,
    featureLabel: aiFeatureLabel(r.feature),
    trigger: r.trigger,
    source: r.source,
    userId: r.userId,
    userName: r.userId ? (names.get(r.userId) ?? null) : null,
    jobId: r.jobId,
    jobTitle: r.jobId ? (titles.get(r.jobId) ?? null) : null,
    entityType: r.entityType,
    entityId: r.entityId,
    aiConfigId: r.aiConfigId,
    aiConfigName: r.aiConfigName,
    provider: r.provider,
    model: r.model,
    responseModel: r.responseModel,
    mode: r.mode,
    inputTokens: r.inputTokens,
    cachedInputTokens: r.cachedInputTokens,
    outputTokens: r.outputTokens,
    reasoningTokens: r.reasoningTokens,
    tokensEstimated: r.tokensEstimated,
    promptChars: r.promptChars,
    completionChars: r.completionChars,
    systemPromptHash: r.systemPromptHash,
    durationMs: r.durationMs,
    ttftMs: r.ttftMs,
    status: r.status,
    errorCode: r.errorCode,
    errorMessage: r.errorMessage,
    finishReason: r.finishReason,
    priceCurrency: r.priceCurrency,
    costInConfigCurrency: r.cost === null ? null : Number(r.cost),
    cost: r.costBase === null ? null : Number(r.costBase),
    baseCurrency: r.baseCurrency,
    isBackfilled: r.isBackfilled,
  }
}

export async function presentEvents(rows: AiUsageEventRow[]) {
  const [names, titles] = await Promise.all([
    userNames(rows.map(r => r.userId ?? '')),
    jobTitles(rows.map(r => r.jobId ?? '')),
  ])
  return rows.map(r => presentEvent(r, names, titles))
}

/** Курсор = `<ISO created_at>|<id>` (сортировка created_at desc, id desc). */
export function cursorWhere(cursor: string | undefined): SQL | undefined {
  if (!cursor) return undefined
  const [ts, id] = cursor.split('|')
  const at = ts ? new Date(ts) : null
  if (!at || Number.isNaN(at.getTime()) || !id) return undefined
  const e = aiUsageEvent
  return or(lt(e.createdAt, at), and(eq(e.createdAt, at), lt(e.id, id)))
}

export async function listEvents(orgId: string, f: UsageFilters, opts: { cursor?: string; limit: number; traceId?: string }) {
  const e = aiUsageEvent
  const rows = await db.select().from(e)
    .where(usageWhere(orgId, f, [cursorWhere(opts.cursor), opts.traceId ? eq(e.traceId, opts.traceId) : undefined]))
    .orderBy(desc(e.createdAt), desc(e.id))
    .limit(opts.limit + 1)
  const hasMore = rows.length > opts.limit
  const page = hasMore ? rows.slice(0, opts.limit) : rows
  const last = page[page.length - 1]
  return {
    items: await presentEvents(page),
    nextCursor: hasMore && last ? `${last.createdAt.toISOString()}|${last.id}` : null,
  }
}

