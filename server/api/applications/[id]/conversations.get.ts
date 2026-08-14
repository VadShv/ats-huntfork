import { z } from 'zod'
import {
  ensureHhConversation,
  listConversationMessages,
  refreshHhConversation,
} from '../../../utils/comms/commsService'

const paramsSchema = z.object({ id: z.string().min(1) })

/**
 * GET /api/applications/:id/conversations
 *
 * Возвращает hh-диалог отклика и его сообщения. При каждом вызове
 * подтягивает свежие сообщения из hh.ru (sync-on-read): открытая вкладка
 * «Чат» опрашивает этот эндпоинт, фоновых воркеров не требуется.
 */
export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const orgId = session.session.activeOrganizationId
  const { id: applicationId } = await getValidatedRouterParams(event, paramsSchema.parse)

  const { conversation, reason } = await ensureHhConversation(applicationId, orgId)
  if (!conversation) {
    return { conversation: null, messages: [], reason: reason ?? 'no_chat' }
  }

  let syncError: string | null = null
  try {
    await refreshHhConversation(conversation)
  }
  catch (err) {
    syncError = err instanceof Error ? err.message : String(err)
    logWarn('comms.refresh_failed', { conversation_id: conversation.id, error_message: syncError })
  }

  // Перечитываем диалог после refresh (обновились can_write/счётчики)
  const fresh = await db.query.commsConversation.findFirst({
    where: (t, { eq }) => eq(t.id, conversation.id),
  })
  const messages = await listConversationMessages(conversation.id)

  return {
    conversation: {
      id: fresh?.id ?? conversation.id,
      channel: fresh?.channel ?? 'hh',
      canWrite: fresh?.canWrite ?? conversation.canWrite,
      canWriteReason: fresh?.canWriteReason ?? conversation.canWriteReason,
      unreadCount: fresh?.unreadCount ?? conversation.unreadCount,
      assistantMode: fresh?.assistantMode ?? conversation.assistantMode,
      lastSyncedAt: fresh?.lastSyncedAt ?? null,
    },
    messages: messages.map(m => ({
      id: m.id,
      externalMessageId: m.externalMessageId,
      direction: m.direction,
      senderType: m.senderType,
      senderName: m.senderName,
      body: m.body,
      attachments: m.attachments,
      status: m.status,
      errorMessage: m.errorMessage,
      createdAt: (m.externalCreatedAt ?? m.createdAt)?.toISOString?.() ?? null,
    })),
    syncError,
  }
})
