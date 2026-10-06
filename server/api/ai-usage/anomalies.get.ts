/**
 * GET /api/ai-usage/anomalies — «Потери и аномалии» (docs/tz-ai-usage.md §8.1, блок 5):
 *  - топ-10 самых дорогих одиночных вызовов;
 *  - операции, подорожавшие > 1,5× за вызов к прошлому периоду, с причиной;
 *  - операции с ошибками > 10 %;
 *  - вызовы, упёршиеся в лимит токенов (finish_reason = length).
 */
import { desc, sql } from 'drizzle-orm'
import { aiUsageEvent } from '../../database/schema'
import { aiOperationLabel } from '../../../shared/aiUsage/catalog'
import {
  previousPeriod, requireAiUsageAccess, resolveUsageFilters, stripCosts, usageFilterSchema, usageWhere, userNames,
} from '../../utils/ai/usage/query'

const MIN_CALLS = 5

export default defineEventHandler(async (event) => {
  const access = await requireAiUsageAccess(event)
  const q = await getValidatedQuery(event, usageFilterSchema.parse)
  const f = resolveUsageFilters(q, access)
  const prev = previousPeriod(f)
  const e = aiUsageEvent

  const opStats = (where: ReturnType<typeof usageWhere>) => db.select({
    operation: e.operation,
    calls: sql<number>`count(*)::int`,
    cost: sql<number>`coalesce(sum(${e.costBase}), 0)::float8`,
    avgCost: sql<number | null>`avg(${e.costBase})::float8`,
    avgInput: sql<number | null>`avg(${e.inputTokens})::float8`,
    avgOutput: sql<number | null>`avg(${e.outputTokens})::float8`,
    avgPromptChars: sql<number | null>`avg(${e.promptChars})::float8`,
    topModel: sql<string | null>`mode() within group (order by ${e.model})`,
    topHash: sql<string | null>`mode() within group (order by ${e.systemPromptHash})`,
    errors: sql<number>`count(*) filter (where ${e.status} in ('error','timeout','aborted'))::int`,
    lengthCut: sql<number>`count(*) filter (where ${e.finishReason} = 'length')::int`,
    lengthCost: sql<number>`coalesce(sum(${e.costBase}) filter (where ${e.finishReason} = 'length'), 0)::float8`,
  }).from(e).where(where).groupBy(e.operation)

  const [expensive, cur, before] = await Promise.all([
    db.select({
      id: e.id, createdAt: e.createdAt, traceId: e.traceId, operation: e.operation, model: e.model,
      userId: e.userId, inputTokens: e.inputTokens, outputTokens: e.outputTokens, reasoningTokens: e.reasoningTokens,
      cost: e.costBase, status: e.status, durationMs: e.durationMs,
    }).from(e).where(usageWhere(access.orgId, f))
      .orderBy(access.canViewCosts ? desc(sql`coalesce(${e.costBase}, 0)`) : desc(sql`${e.inputTokens} + ${e.outputTokens}`))
      .limit(10),
    opStats(usageWhere(access.orgId, f)),
    opStats(usageWhere(access.orgId, prev)),
  ])

  const prevBy = new Map(before.map(r => [r.operation, r]))
  const pricier: Array<Record<string, unknown>> = []
  for (const r of cur) {
    const p = prevBy.get(r.operation)
    if (!p || Number(r.calls) < MIN_CALLS || Number(p.calls) < MIN_CALLS) continue
    // Сравниваем стоимость за вызов (если есть цены) или токены за вызов.
    const nowUnit = access.canViewCosts && r.avgCost ? Number(r.avgCost) : Number(r.avgInput ?? 0) + Number(r.avgOutput ?? 0)
    const prevUnit = access.canViewCosts && p.avgCost ? Number(p.avgCost) : Number(p.avgInput ?? 0) + Number(p.avgOutput ?? 0)
    if (!prevUnit || nowUnit / prevUnit <= 1.5) continue
    const reasons: string[] = []
    if (r.topModel !== p.topModel) reasons.push(`сменилась модель: ${p.topModel ?? '—'} → ${r.topModel ?? '—'}`)
    if (r.topHash && p.topHash && r.topHash !== p.topHash) reasons.push('новая версия промпта (другой хэш)')
    const pc = Number(r.avgPromptChars ?? 0), ppc = Number(p.avgPromptChars ?? 0)
    if (ppc > 0 && pc / ppc > 1.3) reasons.push(`вырос промпт: ≈${Math.round(ppc)} → ≈${Math.round(pc)} симв.`)
    const ao = Number(r.avgOutput ?? 0), pao = Number(p.avgOutput ?? 0)
    if (pao > 0 && ao / pao > 1.5) reasons.push('выросла длина ответа')
    pricier.push({
      operation: r.operation,
      label: aiOperationLabel(r.operation),
      ratio: nowUnit / prevUnit,
      avgCost: r.avgCost === null ? null : Number(r.avgCost),
      prevAvgCost: p.avgCost === null ? null : Number(p.avgCost),
      avgTokens: Math.round(Number(r.avgInput ?? 0) + Number(r.avgOutput ?? 0)),
      prevAvgTokens: Math.round(Number(p.avgInput ?? 0) + Number(p.avgOutput ?? 0)),
      calls: Number(r.calls),
      reasons: reasons.length ? reasons : ['причина не определена — сравните последние вызовы'],
    })
  }

  const errorOps = cur
    .filter(r => Number(r.calls) >= MIN_CALLS && Number(r.errors) / Number(r.calls) > 0.1)
    .map(r => ({ operation: r.operation, label: aiOperationLabel(r.operation), calls: Number(r.calls), errors: Number(r.errors), errorRate: Number(r.errors) / Number(r.calls) }))
    .sort((a, b) => b.errorRate - a.errorRate)

  const lengthOps = cur
    .filter(r => Number(r.lengthCut) > 0)
    .map(r => ({ operation: r.operation, label: aiOperationLabel(r.operation), calls: Number(r.calls), lengthCut: Number(r.lengthCut), lengthCost: Number(r.lengthCost) }))
    .sort((a, b) => b.lengthCut - a.lengthCut)

  const names = await userNames(expensive.map(x => x.userId ?? ''))
  return stripCosts({
    expensive: expensive.map(x => ({
      ...x,
      createdAt: x.createdAt.toISOString(),
      label: aiOperationLabel(x.operation),
      userName: x.userId ? (names.get(x.userId) ?? null) : null,
      cost: x.cost === null ? null : Number(x.cost),
    })),
    pricier: pricier.sort((a, b) => Number(b.ratio) - Number(a.ratio)),
    errorOps,
    lengthOps,
  }, access.canViewCosts)
})

