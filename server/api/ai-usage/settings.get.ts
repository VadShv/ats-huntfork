/**
 * GET /api/ai-usage/settings — валюта отчётов, курс USD→RUB, срок хранения журнала
 * (docs/tz-ai-usage.md §4.3).
 */
import { requireAiUsageAccess } from '../../utils/ai/usage/query'

export default defineEventHandler(async (event) => {
  const access = await requireAiUsageAccess(event)
  const row = await db.query.aiUsageSettings.findFirst({
    where: (t, { eq }) => eq(t.organizationId, access.orgId),
  })
  return {
    baseCurrency: access.currency.baseCurrency,
    usdRubRate: access.currency.usdRubRate,
    rateIsDefault: access.currency.rateIsDefault,
    rateUpdatedAt: row?.rateUpdatedAt?.toISOString() ?? null,
    retentionDays: access.currency.retentionDays,
    canManage: access.canManageBudgets,
    canRecalculate: access.canRecalculate,
  }
})
