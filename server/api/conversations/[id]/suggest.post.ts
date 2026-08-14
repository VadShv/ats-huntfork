import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { commsConversation } from '../../../database/schema'
import { requireAssistantConfig } from '../../../utils/comms/assistant'
import { requestSuggestDraft } from '../../../utils/comms/assistantJobs'

const paramsSchema = z.object({ id: z.string().min(1) })

/**
 * POST /api/conversations/:id/suggest — запросить черновик ответа ассистента.
 *
 * Чат 2.0: генерация идёт В ФОНЕ (pg-boss) — эндпоинт сразу возвращает
 * черновик со статусом `generating`, фронт опрашивает GET /suggest.
 * Обновление страницы генерацию не сбрасывает. Повторный вызов при живой
 * генерации идемпотентен — вернётся тот же черновик.
 */
export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const orgId = session.session.activeOrganizationId
  const { id } = await getValidatedRouterParams(event, paramsSchema.parse)

  const conv = await db.query.commsConversation.findFirst({
    where: and(eq(commsConversation.id, id), eq(commsConversation.organizationId, orgId)),
  })
  if (!conv) {
    throw createError({ statusCode: 404, statusMessage: 'Диалог не найден' })
  }

  // Ранний гейт: понятная ошибка вместо тихо протухающего черновика
  await requireAssistantConfig(orgId)

  const draft = await requestSuggestDraft(conv, orgId)
  return { draft }
})
