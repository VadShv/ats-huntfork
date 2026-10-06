/**
 * DELETE /api/ai-usage/budgets/:id — удалить бюджет (сработавшие пороги удаляются каскадом).
 */
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { aiUsageBudget } from '../../../database/schema'
import { invalidateBudgetCache } from '../../../utils/ai/usage/budget'
import { requireAiUsageAccess } from '../../../utils/ai/usage/query'

export default defineEventHandler(async (event) => {
  const access = await requireAiUsageAccess(event, 'manage_budgets')
  const { id } = await getValidatedRouterParams(event, z.object({ id: z.string().min(1) }).parse)
  const [row] = await db.delete(aiUsageBudget)
    .where(and(eq(aiUsageBudget.id, id), eq(aiUsageBudget.organizationId, access.orgId)))
    .returning()
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Бюджет не найден' })
  invalidateBudgetCache(access.orgId)
  await recordActivity({
    organizationId: access.orgId,
    actorId: access.userId,
    action: 'deleted',
    resourceType: 'ai_usage_budget',
    resourceId: id,
    before: { ...row },
  })
  return { ok: true }
})
