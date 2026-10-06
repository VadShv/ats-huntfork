/**
 * Встройки расхода ИИ в существующие экраны (docs/tz-ai-usage.md §8.3):
 * сводка по вакансии / кандидату / карте поиска с разбивкой по операциям.
 */
import { desc, sql, type SQL } from 'drizzle-orm'
import { aiUsageEvent } from '../../../database/schema'
import { aiOperationLabel } from '../../../../shared/aiUsage/catalog'
import { aggColumns, normalizeAgg, stripCosts, usageWhere, type AiUsageAccess, type UsageFilters } from './query'

export async function embedSummary(access: AiUsageAccess, scope: SQL, opts: { days?: number } = {}) {
  const e = aiUsageEvent
  const now = new Date()
  const f: UsageFilters = {
    from: new Date(now.getTime() - (opts.days ?? 3650) * 86_400_000),
    to: new Date(now.getTime() + 60_000),
    userId: access.canViewOrg ? undefined : access.userId,
  }
  const where = usageWhere(access.orgId, f, [scope])
  const [[total], ops] = await Promise.all([
    db.select(aggColumns()).from(e).where(where),
    db.select({
      operation: e.operation,
      calls: sql<number>`count(*)::int`,
      traces: sql<number>`count(distinct ${e.traceId})::int`,
      tokens: sql<number>`coalesce(sum(${e.inputTokens} + ${e.outputTokens}), 0)::bigint`,
      cost: sql<number>`coalesce(sum(${e.costBase}), 0)::float8`,
      avgCostPerTrace: sql<number | null>`(coalesce(sum(${e.costBase}), 0) / nullif(count(distinct ${e.traceId}), 0))::float8`,
      lastAt: sql<string | null>`max(${e.createdAt})`,
      lastDurationMs: sql<number | null>`(array_agg(${e.durationMs} order by ${e.createdAt} desc))[1]`,
    }).from(e).where(where).groupBy(e.operation).orderBy(desc(sql`coalesce(sum(${e.costBase}), 0)`), desc(sql`count(*)`)),
  ])
  return stripCosts({
    scope: access.canViewOrg ? 'org' as const : 'own' as const,
    currency: access.currency.baseCurrency,
    totals: normalizeAgg(total!),
    operations: ops.map(o => ({
      key: o.operation,
      label: aiOperationLabel(o.operation),
      calls: Number(o.calls),
      traces: Number(o.traces),
      tokens: Number(o.tokens),
      cost: Number(o.cost),
      avgCostPerTrace: o.avgCostPerTrace === null ? null : Number(o.avgCostPerTrace),
      lastAt: o.lastAt ? new Date(o.lastAt).toISOString() : null,
      lastDurationMs: o.lastDurationMs === null ? null : Number(o.lastDurationMs),
    })),
  }, access.canViewCosts)
}
