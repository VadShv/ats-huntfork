/**
 * GET /api/ai-usage/timeseries?groupBy=feature|model|trigger&interval=day|week
 * Ряды для графика «Динамика» (docs/tz-ai-usage.md §8.1, блок 2): стек по группе.
 */
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { aiUsageEvent } from '../../database/schema'
import { AI_FEATURE_COLORS, AI_TRIGGER_LABELS, aiFeatureLabel, type AiFeature, type AiTrigger } from '../../../shared/aiUsage/catalog'
import { AI_USAGE_TIMEZONE, bucketExpr, requireAiUsageAccess, resolveUsageFilters, stripCosts, usageFilterSchema, usageWhere } from '../../utils/ai/usage/query'

const schema = usageFilterSchema.extend({
  groupBy: z.enum(['feature', 'model', 'trigger']).default('feature'),
  interval: z.enum(['day', 'week']).default('day'),
})

const PALETTE = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#14b8a6', '#ec4899', '#84cc16', '#64748b']

export default defineEventHandler(async (event) => {
  const access = await requireAiUsageAccess(event)
  const q = await getValidatedQuery(event, schema.parse)
  const f = resolveUsageFilters(q, access)
  const e = aiUsageEvent
  const bucket = bucketExpr(q.interval)
  const groupCol = q.groupBy === 'model' ? e.model : q.groupBy === 'trigger' ? e.trigger : e.feature

  const rows = await db.select({
    bucket,
    key: groupCol,
    calls: sql<number>`count(*)::int`,
    tokens: sql<number>`coalesce(sum(${e.inputTokens} + ${e.outputTokens}), 0)::bigint`,
    cost: sql<number>`coalesce(sum(${e.costBase}), 0)::float8`,
  }).from(e).where(usageWhere(access.orgId, f)).groupBy(bucket, groupCol).orderBy(bucket)

  // Полная сетка бакетов, чтобы на графике не было «дыр».
  const buckets: string[] = []
  const step = q.interval === 'week' ? 7 : 1
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: AI_USAGE_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' })
  const firstBucket = rows[0]?.bucket
  let cursor = new Date(f.from)
  if (q.interval === 'week' && firstBucket) cursor = new Date(`${firstBucket}T12:00:00Z`)
  for (let i = 0; i < 400 && cursor < f.to; i++) {
    const k = fmt.format(cursor)
    if (!buckets.includes(k)) buckets.push(k)
    cursor = new Date(cursor.getTime() + step * 86_400_000)
  }
  // Текущий (неполный) день тоже в сетке — шаг от f.from может его «перешагнуть».
  if (q.interval !== 'week') {
    const last = fmt.format(new Date(f.to.getTime() - 1))
    if (!buckets.includes(last)) buckets.push(last)
  }
  for (const r of rows) if (!buckets.includes(r.bucket)) buckets.push(r.bucket)
  buckets.sort()

  const byKey = new Map<string, { calls: number[]; tokens: number[]; cost: number[]; total: number }>()
  for (const r of rows) {
    const key = r.key ?? '—'
    let s = byKey.get(key)
    if (!s) {
      s = { calls: buckets.map(() => 0), tokens: buckets.map(() => 0), cost: buckets.map(() => 0), total: 0 }
      byKey.set(key, s)
    }
    const i = buckets.indexOf(r.bucket)
    s.calls[i] = Number(r.calls)
    s.tokens[i] = Number(r.tokens)
    s.cost[i] = Number(r.cost)
    s.total += access.canViewCosts ? Number(r.cost) : Number(r.tokens)
  }
  const series = [...byKey.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .map(([key, s], idx) => ({
      key,
      label: q.groupBy === 'feature' ? aiFeatureLabel(key) : q.groupBy === 'trigger' ? (AI_TRIGGER_LABELS[key as AiTrigger] ?? key) : key,
      color: q.groupBy === 'feature' ? (AI_FEATURE_COLORS[key as AiFeature] ?? PALETTE[idx % PALETTE.length]) : PALETTE[idx % PALETTE.length],
      calls: s.calls,
      tokens: s.tokens,
      cost: s.cost,
    }))

  return stripCosts({ interval: q.interval, groupBy: q.groupBy, buckets, series }, access.canViewCosts)
})
