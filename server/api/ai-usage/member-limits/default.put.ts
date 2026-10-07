/**
 * PUT /api/ai-usage/member-limits/default — лимит по умолчанию для всех участников
 * (кроме owner/admin). null в периоде — снять. Аудит — recordActivity.
 */
import { writeMemberLimits } from '../../../utils/ai/usage/limitsAdmin'
import { requireAiUsageAccess } from '../../../utils/ai/usage/query'
import { memberLimitSchema } from '../../../utils/schemas/aiUsage'

export default defineEventHandler(async (event) => {
  const access = await requireAiUsageAccess(event, 'manage_budgets')
  const body = await readValidatedBody(event, memberLimitSchema.parse)
  const res = await writeMemberLimits({
    orgId: access.orgId, actorId: access.userId, scope: 'member_default', scopeKey: null,
    currency: access.currency.baseCurrency, write: body,
  })
  return { ok: true, ...res }
})
