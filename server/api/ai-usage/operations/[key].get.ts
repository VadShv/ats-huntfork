/**
 * GET /api/ai-usage/operations/:key — карточка операции (docs/tz-ai-usage.md §8.2):
 * описание из Банка промптов, ряды по дням, распределение стоимости вызова (p50/p90/max),
 * версии промпта по хэшу, разбивка по моделям, последние 20 вызовов.
 */
import { desc, sql } from 'drizzle-orm'
import { z } from 'zod'
import { aiUsageEvent } from '../../../database/schema'
import { aiFeatureLabel, aiOperationLabel, getAiOperation } from '../../../../shared/aiUsage/catalog'
import { getPromptById } from '../../../utils/ai/promptRegistry'
import { presentEvents } from '../../../utils/ai/usage/events'
import {
  aggColumns, bucketExpr, normalizeAgg, requireAiUsageAccess, resolveUsageFilters, stripCosts, usageFilterSchema, usageWhere,
} from '../../../utils/ai/usage/query'

export default defineEventHandler(async (event) => {
  const access = await requireAiUsageAccess(event)
  const { key } = await getValidatedRouterParams(event, z.object({ key: z.string().min(1).max(120) }).parse)
  const q = await getValidatedQuery(event, usageFilterSchema.parse)
  const f = { ...resolveUsageFilters(q, access), operation: key }
  const e = aiUsageEvent
  const where = usageWhere(access.orgId, f)
  const bucket = bucketExpr('day')

  const [[total], daily, dist, versions, models, recent] = await Promise.all([
    db.select(aggColumns()).from(e).where(where),
    db.select({
      bucket,
      calls: sql<number>`count(*)::int`,
      cost: sql<number>`coalesce(sum(${e.costBase}), 0)::float8`,
      tokens: sql<number>`coalesce(sum(${e.inputTokens} + ${e.outputTokens}), 0)::bigint`,
    }).from(e).where(where).groupBy(bucket).orderBy(bucket),
    db.select({
      p50: sql<number | null>`percentile_cont(0.5) within group (order by ${e.costBase})::float8`,
      p90: sql<number | null>`percentile_cont(0.9) within group (order by ${e.costBase})::float8`,
      max: sql<number | null>`max(${e.costBase})::float8`,
      tokensP50: sql<number | null>`percentile_cont(0.5) within group (order by ${e.inputTokens} + ${e.outputTokens})::float8`,
      tokensP90: sql<number | null>`percentile_cont(0.9) within group (order by ${e.inputTokens} + ${e.outputTokens})::float8`,
      tokensMax: sql<number | null>`max(${e.inputTokens} + ${e.outputTokens})::float8`,
    }).from(e).where(where),
    db.select({
      hash: e.systemPromptHash,
      firstAt: sql<string>`min(${e.createdAt})`,
      lastAt: sql<string>`max(${e.createdAt})`,
      calls: sql<number>`count(*)::int`,
      avgInput: sql<number | null>`avg(${e.inputTokens})::float8`,
      avgOutput: sql<number | null>`avg(${e.outputTokens})::float8`,
      avgCost: sql<number | null>`avg(${e.costBase})::float8`,
    }).from(e).where(where).groupBy(e.systemPromptHash).orderBy(desc(sql`max(${e.createdAt})`)).limit(20),
    db.select({
      model: e.model,
      provider: e.provider,
      calls: sql<number>`count(*)::int`,
      cost: sql<number>`coalesce(sum(${e.costBase}), 0)::float8`,
      avgCost: sql<number | null>`avg(${e.costBase})::float8`,
      avgDurationMs: sql<number | null>`avg(${e.durationMs})::float8`,
    }).from(e).where(where).groupBy(e.model, e.provider).orderBy(desc(sql`count(*)`)),
    db.select().from(e).where(where).orderBy(desc(e.createdAt)).limit(20),
  ])

  const def = getAiOperation(key)
  const prompt = getPromptById(def?.promptId ?? key)
  const d = dist[0]
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v))

  return stripCosts({
    key,
    label: aiOperationLabel(key),
    feature: def?.feature ?? 'unattributed',
    featureLabel: aiFeatureLabel(def?.feature ?? 'unattributed'),
    purpose: def?.purpose ?? null,
    costNote: def?.costNote ?? null,
    prompt: prompt
      ? { id: prompt.id, name: prompt.name, module: prompt.module, description: prompt.description, sourceFile: prompt.sourceFile, isDynamic: prompt.isDynamic ?? false }
      : null,
    period: { from: f.from.toISOString(), to: f.to.toISOString() },
    totals: normalizeAgg(total!),
    daily: daily.map(r => ({ date: r.bucket, calls: Number(r.calls), cost: Number(r.cost), tokens: Number(r.tokens) })),
    costDistribution: { p50: num(d?.p50), p90: num(d?.p90), max: num(d?.max) },
    tokenDistribution: { p50: num(d?.tokensP50), p90: num(d?.tokensP90), max: num(d?.tokensMax) },
    versions: versions.map(v => ({
      hash: v.hash,
      firstAt: new Date(v.firstAt).toISOString(),
      lastAt: new Date(v.lastAt).toISOString(),
      calls: Number(v.calls),
      avgInputTokens: Math.round(Number(v.avgInput ?? 0)),
      avgOutputTokens: Math.round(Number(v.avgOutput ?? 0)),
      avgCost: num(v.avgCost),
    })),
    models: models.map(m => ({
      model: m.model, provider: m.provider, calls: Number(m.calls), cost: Number(m.cost),
      avgCost: num(m.avgCost), avgDurationMs: m.avgDurationMs === null ? null : Math.round(Number(m.avgDurationMs)),
    })),
    recent: await presentEvents(recent),
  }, access.canViewCosts)
})
