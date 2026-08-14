import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { commsConversation } from '../../../database/schema'
import { suggestReply } from '../../../utils/comms/assistant'

const paramsSchema = z.object({ id: z.string().min(1) })

/**
 * POST /api/conversations/:id/suggest — черновик ответа от AI-ассистента
 * (Спринт 18.5, режим «суфлёр»). Черновик НЕ отправляется кандидату:
 * он возвращается в композер, рекрутёр правит и отправляет сам.
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

  const { text, messageId } = await suggestReply(conv, orgId)
  return { text, messageId }
})
