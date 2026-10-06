/**
 * GET /api/ai-usage/traces/:traceId — все шаги одного действия на временной шкале
 * (docs/tz-ai-usage.md §8.1, блок 6): части карты поиска, шаги агента чат-бота.
 */
import { and, asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { aiUsageEvent } from '../../../database/schema'
import { presentEvents } from '../../../utils/ai/usage/events'
import { requireAiUsageAccess, stripCosts } from '../../../utils/ai/usage/query'

export default defineEventHandler(async (event) => {
  const access = await requireAiUsageAccess(event)
  const { traceId } = await getValidatedRouterParams(event, z.object({ traceId: z.string().min(1).max(100) }).parse)
  const e = aiUsageEvent
  const rows = await db.select().from(e)
    .where(and(
      eq(e.organizationId, access.orgId),
      eq(e.traceId, traceId),
      access.canViewOrg ? undefined : eq(e.userId, access.userId),
    ))
    .orderBy(asc(e.createdAt), asc(e.stepNo))
    .limit(500)
  if (!rows.length) throw createError({ statusCode: 404, statusMessage: 'Трейс не найден' })

  const items = await presentEvents(rows)
  // createdAt события = момент старта вызова; конец = старт + длительность.
  const startedAt = Math.min(...rows.map(r => r.createdAt.getTime()))
  const timeline = items.map((it, i) => ({
    ...it,
    offsetMs: rows[i]!.createdAt.getTime() - startedAt,
    spanMs: rows[i]!.durationMs ?? 0,
  }))
  const finishedAt = Math.max(...rows.map(r => r.createdAt.getTime() + (r.durationMs ?? 0)))
  const costs = rows.map(r => (r.costBase === null ? null : Number(r.costBase)))
  return stripCosts({
    traceId,
    steps: timeline,
    totals: {
      calls: rows.length,
      inputTokens: rows.reduce((s, r) => s + r.inputTokens, 0),
      outputTokens: rows.reduce((s, r) => s + r.outputTokens, 0),
      reasoningTokens: rows.reduce((s, r) => s + r.reasoningTokens, 0),
      cost: costs.some(c => c !== null) ? costs.reduce<number>((s, c) => s + (c ?? 0), 0) : null,
      wallMs: finishedAt - startedAt,
      errors: rows.filter(r => r.status === 'error' || r.status === 'timeout' || r.status === 'aborted').length,
    },
  }, access.canViewCosts)
})
