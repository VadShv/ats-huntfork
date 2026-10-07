/**
 * POST /api/me/ai-limits/request-increase — попросить владельца/администратора увеличить
 * мой лимит. Уведомление ai_budget адресатам; один запрос на период.
 */
import { requestLimitIncrease } from '../../../utils/ai/usage/limits'
import { requireAiUsageAccess } from '../../../utils/ai/usage/query'
import { limitIncreaseRequestSchema } from '../../../utils/schemas/aiUsage'

export default defineEventHandler(async (event) => {
  const access = await requireAiUsageAccess(event)
  const body = await readValidatedBody(event, limitIncreaseRequestSchema.parse)
  const recipients = await requestLimitIncrease(access.orgId, access.userId, body.period, body.comment)
  return { ok: true, recipients }
})
