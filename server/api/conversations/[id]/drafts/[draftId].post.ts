import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { commsConversation, commsMessage } from '../../../../database/schema'
import { sendHhMessage } from '../../../../utils/comms/commsService'

const paramsSchema = z.object({ id: z.string().min(1), draftId: z.string().min(1) })
const bodySchema = z.object({
  /**
   * consume — черновик забран в композер (суфлёр), больше не показываем;
   * discard — отклонить черновик (или отменить идущую генерацию);
   * approve — ревью автопилота: отправить кандидату от имени агента.
   */
  action: z.enum(['consume', 'discard', 'approve']),
})

/**
 * POST /api/conversations/:id/drafts/:draftId — резолюция черновика ассистента (Чат 2.0).
 */
export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const orgId = session.session.activeOrganizationId
  const { id, draftId } = await getValidatedRouterParams(event, paramsSchema.parse)
  const body = await readValidatedBody(event, bodySchema.parse)

  const conv = await db.query.commsConversation.findFirst({
    where: and(eq(commsConversation.id, id), eq(commsConversation.organizationId, orgId)),
  })
  if (!conv) {
    throw createError({ statusCode: 404, statusMessage: 'Диалог не найден' })
  }

  const draft = await db.query.commsMessage.findFirst({
    where: and(
      eq(commsMessage.id, draftId),
      eq(commsMessage.conversationId, conv.id),
      eq(commsMessage.senderType, 'agent'),
      inArray(commsMessage.status, ['generating', 'suggested']),
    ),
  })
  if (!draft) {
    throw createError({ statusCode: 404, statusMessage: 'Черновик не найден или уже обработан' })
  }

  if (body.action === 'approve') {
    if (draft.status !== 'suggested' || !draft.body?.trim()) {
      throw createError({ statusCode: 400, statusMessage: 'Черновик ещё не готов к отправке' })
    }
    // Отправка от имени агента; одобривший рекрутёр фиксируется в senderUserId
    const message = await sendHhMessage(conv, {
      userId: session.user.id,
      userName: session.user.name ?? null,
      text: draft.body,
      senderType: 'agent',
      senderName: draft.senderName,
    })
    await db.update(commsMessage)
      .set({ status: 'discarded', errorMessage: 'approved_and_sent', updatedAt: new Date() })
      .where(eq(commsMessage.id, draft.id))
    logInfo('comms.draft_approved', { conversation_id: conv.id, draft_id: draft.id })
    return {
      ok: true,
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
  }

  // consume / discard: generating можно только отменить (discard)
  if (body.action === 'consume' && draft.status !== 'suggested') {
    throw createError({ statusCode: 400, statusMessage: 'Черновик ещё генерируется' })
  }
  await db.update(commsMessage)
    .set({
      status: 'discarded',
      errorMessage: body.action === 'consume' ? 'consumed_to_composer' : 'discarded_by_user',
      updatedAt: new Date(),
    })
    .where(eq(commsMessage.id, draft.id))
  return { ok: true }
})
