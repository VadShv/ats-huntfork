/**
 * PUT /api/ai-usage/settings — меняет валюту отчётов / курс / срок хранения.
 * При смене курса или валюты пересчитывается cost_base (cost в валюте цены не трогаем).
 * Пишется в журнал активности (docs/tz-ai-usage.md §10.3).
 */
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { aiUsageSettings } from '../../database/schema'
import { invalidateAiPricingCache } from '../../utils/ai/usage/pricing'
import { invalidateBudgetCache } from '../../utils/ai/usage/budget'
import { requireAiUsageAccess } from '../../utils/ai/usage/query'

const bodySchema = z.object({
  baseCurrency: z.enum(['RUB', 'USD']).optional(),
  usdRubRate: z.number().positive().max(100_000).nullable().optional(),
  retentionDays: z.number().int().min(30).max(3650).optional(),
  /** Резервная цена за 1 млн токенов для событий без цены (лимиты участников); null — авто. */
  fallbackPricePer1m: z.number().min(0).max(1_000_000).nullable().optional(),
  /** Пересчитать cost_base истории по новому курсу (по умолчанию — да). */
  recalcHistory: z.boolean().optional(),
})

export default defineEventHandler(async (event) => {
  const access = await requireAiUsageAccess(event, 'manage_budgets')
  const body = await readValidatedBody(event, bodySchema.parse)
  const before = access.currency

  const next = {
    baseCurrency: body.baseCurrency ?? before.baseCurrency,
    usdRubRate: body.usdRubRate === undefined ? (before.rateIsDefault ? null : before.usdRubRate) : body.usdRubRate,
    retentionDays: body.retentionDays ?? before.retentionDays,
    fallbackPricePer1m: body.fallbackPricePer1m === undefined ? before.fallbackPricePer1m : body.fallbackPricePer1m,
  }
  const rateChanged = body.usdRubRate !== undefined && body.usdRubRate !== (before.rateIsDefault ? null : before.usdRubRate)

  await db.insert(aiUsageSettings).values({
    organizationId: access.orgId,
    baseCurrency: next.baseCurrency,
    usdRubRate: next.usdRubRate === null ? null : String(next.usdRubRate),
    rateUpdatedAt: rateChanged ? new Date() : undefined,
    retentionDays: next.retentionDays,
    fallbackPricePer1m: next.fallbackPricePer1m === null ? null : String(next.fallbackPricePer1m),
    updatedById: access.userId,
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: aiUsageSettings.organizationId,
    set: {
      baseCurrency: next.baseCurrency,
      usdRubRate: next.usdRubRate === null ? null : String(next.usdRubRate),
      ...(rateChanged ? { rateUpdatedAt: new Date() } : {}),
      retentionDays: next.retentionDays,
      fallbackPricePer1m: next.fallbackPricePer1m === null ? null : String(next.fallbackPricePer1m),
      updatedById: access.userId,
      updatedAt: new Date(),
    },
  })
  invalidateAiPricingCache(access.orgId)
  invalidateBudgetCache(access.orgId)

  let recalculated = 0
  const currencyChanged = next.baseCurrency !== before.baseCurrency
  if ((rateChanged || currencyChanged) && body.recalcHistory !== false) {
    const rate = next.usdRubRate ?? 90
    const res = await db.execute(sql`
      UPDATE ai_usage_event SET
        base_currency = ${next.baseCurrency},
        fx_rate = CASE
          WHEN price_currency = ${next.baseCurrency} THEN 1
          WHEN price_currency = 'USD' AND ${next.baseCurrency} = 'RUB' THEN ${rate}::numeric
          WHEN price_currency = 'RUB' AND ${next.baseCurrency} = 'USD' THEN round(1 / ${rate}::numeric, 6)
          ELSE NULL END,
        cost_base = CASE
          WHEN cost IS NULL THEN NULL
          WHEN price_currency = ${next.baseCurrency} THEN cost
          WHEN price_currency = 'USD' AND ${next.baseCurrency} = 'RUB' THEN round(cost * ${rate}::numeric, 6)
          WHEN price_currency = 'RUB' AND ${next.baseCurrency} = 'USD' THEN round(cost / ${rate}::numeric, 6)
          ELSE NULL END
      WHERE organization_id = ${access.orgId}
    `)
    recalculated = (res as unknown as { count?: number }).count ?? 0
  }

  await recordActivity({
    organizationId: access.orgId,
    actorId: access.userId,
    action: 'updated',
    resourceType: 'ai_usage_settings',
    resourceId: access.orgId,
    metadata: { recalculated },
    before: { baseCurrency: before.baseCurrency, usdRubRate: before.rateIsDefault ? null : before.usdRubRate, retentionDays: before.retentionDays },
    after: next,
  })

  return { ok: true, ...next, recalculated }
})
