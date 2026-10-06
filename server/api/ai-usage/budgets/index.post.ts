/**
 * POST /api/ai-usage/budgets — создать бюджет (docs/tz-ai-usage.md §7.1). Аудит — recordActivity.
 */
import { aiUsageBudget } from '../../../database/schema'
import { checkBudgets, invalidateBudgetCache } from '../../../utils/ai/usage/budget'
import { requireAiUsageAccess } from '../../../utils/ai/usage/query'
import { createBudgetSchema } from '../../../utils/schemas/aiUsage'

export default defineEventHandler(async (event) => {
  const access = await requireAiUsageAccess(event, 'manage_budgets')
  const body = await readValidatedBody(event, createBudgetSchema.parse)
  const [row] = await db.insert(aiUsageBudget).values({
    organizationId: access.orgId,
    scope: body.scope,
    scopeKey: body.scope === 'org' ? null : (body.scopeKey ?? null),
    period: body.period,
    limitAmount: body.limitAmount.toFixed(2),
    currency: body.currency ?? access.currency.baseCurrency,
    thresholds: body.thresholds,
    onExceed: body.onExceed,
    isActive: body.isActive,
    createdById: access.userId,
  }).returning()
  invalidateBudgetCache(access.orgId)
  await recordActivity({
    organizationId: access.orgId,
    actorId: access.userId,
    action: 'created',
    resourceType: 'ai_usage_budget',
    resourceId: row!.id,
    after: { ...body },
  })
  // Сразу проверяем пороги: бюджет может быть уже превышен.
  checkBudgets(access.orgId).catch(() => {})
  return row
})
