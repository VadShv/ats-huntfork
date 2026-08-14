import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { commsConversation } from '../../../database/schema'
import { markConversationRead } from '../../../utils/comms/commsService'

const paramsSchema = z.object({ id: z.string().min(1) })

/**
 * POST /api/conversations/:id/read
 * Отметить диалог прочитанным (сбрасывает счётчик локально и в hh.ru).
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

  await markConversationRead(conv)
  return { ok: true }
})
