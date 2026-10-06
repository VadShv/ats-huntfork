/**
 * PATCH /api/ai-usage/budgets/:id — изменить бюджет. Аудит — recordActivity.
 */
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { aiUsageBudget } from '../../../database/schema'
import { checkBudgets, invalidateBudgetCache } from '../../../utils/ai/usage/budget'
import { requireAiUsageAccess } from '../../../utils/ai/usage/query'
import { updateBudgetSchema } from '../../../utils/schemas/aiUsage'

export default defineEventHandler(async (event) => {
  const access = await requireAiUsageAccess(event, 'manage_budgets')
  const { id } = await getValidatedRouterParams(event, z.object({ id: z.string().min(1) }).parse)
  const body = await readValidatedBody(event, updateBudgetSchema.parse)
  const before = await db.query.aiUsageBudget.findFirst({
    where: and(eq(aiUsageBudget.id, id), eq(aiUsageBudget.organizationId, access.orgId)),
  })
  if (!before) throw createError({ statusCode: 404, statusMessage: 'Бюджет не найден' })
  const scope = body.scope ?? before.scope
  const [row] = await db.update(aiUsageBudget).set({
    ...(body.scope !== undefined ? { scope: body.scope } : {}),
    ...(body.scopeKey !== undefined || body.scope !== undefined ? { scopeKey: scope === 'org' ? null : (body.scopeKey ?? before.scopeKey) } : {}),
    ...(body.period !== undefined ? { period: body.period } : {}),
    ...(body.limitAmount !== undefined ? { limitAmount: body.limitAmount.toFixed(2) } : {}),
    ...(body.currency !== undefined ? { currency: body.currency } : {}),
    ...(body.thresholds !== undefined ? { thresholds: body.thresholds } : {}),
    ...(body.onExceed !== undefined ? { onExceed: body.onExceed } : {}),
    ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
    updatedAt: new Date(),
  }).where(eq(aiUsageBudget.id, id)).returning()
  invalidateBudgetCache(access.orgId)
  await recordActivity({
    organizationId: access.orgId,
    actorId: access.userId,
    action: 'updated',
    resourceType: 'ai_usage_budget',
    resourceId: id,
    before: { ...before },
    after: { ...row },
  })
  checkBudgets(access.orgId).catch(() => {})
  return row
})
