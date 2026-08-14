import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { commsConversation } from '../../../database/schema'

const paramsSchema = z.object({ id: z.string().min(1) })
const bodySchema = z.object({
  mode: z.enum(['off', 'copilot', 'autopilot_review', 'autopilot']),
})

/**
 * PATCH /api/conversations/:id/assistant — переключатель бот/человек
 * per-диалог (Спринт 18.5). Рекрутёр может в любой момент забрать диалог
 * у ассистента или передать обратно. Автопилот-режимы включаются в 18.6.
 */
export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const orgId = session.session.activeOrganizationId
  const { id } = await getValidatedRouterParams(event, paramsSchema.parse)
  const body = await readValidatedBody(event, bodySchema.parse)

  const conv = await db.query.commsConversation.findFirst({
    where: and(eq(commsConversation.id, id), eq(commsConversation.organizationId, orgId)),
    columns: { id: true, assistantMode: true },
  })
  if (!conv) {
    throw createError({ statusCode: 404, statusMessage: 'Диалог не найден' })
  }

  await db.update(commsConversation)
    .set({ assistantMode: body.mode, updatedAt: new Date() })
    .where(eq(commsConversation.id, conv.id))

  logInfo('comms.assistant_mode_changed', {
    conversation_id: conv.id,
    from: conv.assistantMode,
    to: body.mode,
    user_id: session.user.id,
  })

  return { ok: true, mode: body.mode }
})
