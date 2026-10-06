/**
 * POST /api/ai-usage/recalculate — пересчёт cost / cost_base истории по ТЕКУЩИМ ценам
 * конфигураций (docs/tz-ai-usage.md §3.4). Только aiUsage:recalculate (владелец).
 * Обычно цена фиксируется на момент вызова; пересчёт нужен, если цены были введены
 * неверно. Пишется в журнал активности.
 */
import { sql } from 'drizzle-orm'
import { invalidateAiPricingCache } from '../../utils/ai/usage/pricing'
import { invalidateBudgetCache } from '../../utils/ai/usage/budget'
import { requireAiUsageAccess } from '../../utils/ai/usage/query'
import { recalculateSchema } from '../../utils/schemas/aiUsage'

export default defineEventHandler(async (event) => {
  const access = await requireAiUsageAccess(event, 'recalculate')
  const body = await readValidatedBody(event, recalculateSchema.parse)
  const from = new Date(body.from)
  const to = new Date(body.to)
  if (!(from < to)) throw createError({ statusCode: 400, statusMessage: 'Неверный период' })
  const base = access.currency.baseCurrency
  const rate = access.currency.usdRubRate

  const res = await db.execute(sql`
    WITH priced AS (
      SELECT e.id,
        c.price_currency AS cur,
        c.input_price_per_1m AS pin,
        c.cached_input_price_per_1m AS pcached,
        c.output_price_per_1m AS pout
      FROM ai_usage_event e
      JOIN LATERAL (
        SELECT * FROM ai_config c
        WHERE c.organization_id = e.organization_id
          AND (c.id = e.ai_config_id OR (e.ai_config_id IS NULL AND c.provider = e.provider AND c.model = e.model))
        ORDER BY (c.id = e.ai_config_id) DESC NULLS LAST, c.is_default_analysis DESC, c.created_at
        LIMIT 1
      ) c ON true
      WHERE e.organization_id = ${access.orgId}
        AND e.created_at >= ${from.toISOString()}::timestamptz AND e.created_at < ${to.toISOString()}::timestamptz
        ${body.aiConfigId ? sql`AND e.ai_config_id = ${body.aiConfigId}` : sql``}
    ), computed AS (
      SELECT p.id, p.cur, p.pin, p.pcached, p.pout,
        CASE WHEN p.pin IS NULL AND p.pout IS NULL THEN NULL ELSE round((
          greatest(e.input_tokens - e.cached_input_tokens, 0) * coalesce(p.pin, 0)
          + e.cached_input_tokens * coalesce(p.pcached, p.pin, 0)
          + e.output_tokens * coalesce(p.pout, 0)
        ) / 1000000.0, 6) END AS cost
      FROM priced p JOIN ai_usage_event e ON e.id = p.id
    )
    UPDATE ai_usage_event e SET
      price_currency = c.cur,
      input_price_per_1m = c.pin,
      cached_input_price_per_1m = c.pcached,
      output_price_per_1m = c.pout,
      cost = c.cost,
      base_currency = ${base},
      fx_rate = CASE WHEN c.cur = ${base} THEN 1
        WHEN c.cur = 'USD' AND ${base} = 'RUB' THEN ${rate}::numeric
        WHEN c.cur = 'RUB' AND ${base} = 'USD' THEN round(1 / ${rate}::numeric, 6) END,
      cost_base = CASE WHEN c.cost IS NULL THEN NULL
        WHEN c.cur = ${base} THEN c.cost
        WHEN c.cur = 'USD' AND ${base} = 'RUB' THEN round(c.cost * ${rate}::numeric, 6)
        WHEN c.cur = 'RUB' AND ${base} = 'USD' THEN round(c.cost / ${rate}::numeric, 6) END
    FROM computed c
    WHERE e.id = c.id
  `)
  const updated = (res as unknown as { count?: number }).count ?? 0
  invalidateAiPricingCache(access.orgId)
  invalidateBudgetCache(access.orgId)

  await recordActivity({
    organizationId: access.orgId,
    actorId: access.userId,
    action: 'updated',
    resourceType: 'ai_usage_recalculate',
    resourceId: access.orgId,
    metadata: { from: body.from, to: body.to, aiConfigId: body.aiConfigId ?? null, updated, baseCurrency: base, usdRubRate: rate },
  })
  return { ok: true, updated }
})
