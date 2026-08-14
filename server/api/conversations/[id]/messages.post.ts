import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { commsConversation } from '../../../database/schema'
import { sendHhMessage } from '../../../utils/comms/commsService'

const paramsSchema = z.object({ id: z.string().min(1) })
const bodySchema = z.object({
  text: z.string().trim().min(1).max(4000),
})

/**
 * POST /api/conversations/:id/messages
 * Отправка сообщения рекрутёром в диалог (MVP: канал hh.ru).
 */
export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const orgId = session.session.activeOrganizationId
  const { id } = await getValidatedRouterParams(event, paramsSchema.parse)
  const body = await readValidatedBody(event, bodySchema.parse)

  const conv = await db.query.commsConversation.findFirst({
    where: and(eq(commsConversation.id, id), eq(commsConversation.organizationId, orgId)),
  })
  if (!conv) {
    throw createError({ statusCode: 404, statusMessage: 'Диалог не найден' })
  }
  if (conv.channel !== 'hh') {
    throw createError({ statusCode: 400, statusMessage: 'Неподдерживаемый канал' })
  }

  const message = await sendHhMessage(conv, {
    userId: session.user.id,
    userName: session.user.name ?? null,
    text: body.text,
  })

  return {
    message: {
      id: message.id,
      externalMessageId: message.externalMessageId,
      direction: message.direction,
      senderType: message.senderType,
      senderName: message.senderName,
      body: message.body,
      status: message.status,
      createdAt: (message.externalCreatedAt ?? message.createdAt)?.toISOString?.() ?? null,
    },
  }
})
