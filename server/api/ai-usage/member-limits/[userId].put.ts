/**
 * PUT /api/ai-usage/member-limits/:userId — личный лимит участника.
 * null в периоде — снять личный лимит (участник возвращается к лимиту по умолчанию).
 */
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { member } from '../../../database/schema/auth'
import { writeMemberLimits } from '../../../utils/ai/usage/limitsAdmin'
import { requireAiUsageAccess } from '../../../utils/ai/usage/query'
import { memberLimitSchema } from '../../../utils/schemas/aiUsage'

export default defineEventHandler(async (event) => {
  const access = await requireAiUsageAccess(event, 'manage_budgets')
  const { userId } = await getValidatedRouterParams(event, z.object({ userId: z.string().min(1).max(100) }).parse)
  const body = await readValidatedBody(event, memberLimitSchema.parse)
  const m = await db.query.member.findFirst({ where: and(eq(member.organizationId, access.orgId), eq(member.userId, userId)) })
  if (!m) throw createError({ statusCode: 404, statusMessage: 'Участник не найден в организации' })
  const res = await writeMemberLimits({
    orgId: access.orgId, actorId: access.userId, scope: 'user', scopeKey: userId,
    currency: access.currency.baseCurrency, write: body,
  })
  return { ok: true, ...res }
})
