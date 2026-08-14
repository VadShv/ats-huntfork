import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { application, commsConversation, commsTelegramBusinessConnection } from '../../../database/schema'
import {
  ensureHhConversation,
  listConversationMessages,
  refreshHhConversation,
  type CommsConversationRow,
} from '../../../utils/comms/commsService'
import { getLatestDraft } from '../../../utils/comms/assistantJobs'
import { getTelegramBotForOrg } from '../../../utils/comms/telegram'

const paramsSchema = z.object({ id: z.string().min(1) })
const querySchema = z.object({ channel: z.enum(['hh', 'telegram']).optional() })

/**
 * GET /api/applications/:id/conversations?channel=hh|telegram
 *
 * Спринт 19: мультиканально. Возвращает доступные каналы отклика
 * (hh + telegram), активный диалог с сообщениями и черновиком ассистента.
 * hh синкается на чтение (sync-on-read); Telegram живёт на вебхуках.
 */
export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const orgId = session.session.activeOrganizationId
  const { id: applicationId } = await getValidatedRouterParams(event, paramsSchema.parse)
  const { channel: requestedChannel } = await getValidatedQuery(event, querySchema.parse)

  // hh-диалог (ленивая инициализация, как раньше)
  const { conversation: hhConv, reason } = await ensureHhConversation(applicationId, orgId)

  // Telegram-диалог: сперва по отклику, затем по кандидату (после перепривязки)
  const app = await db.query.application.findFirst({
    where: and(eq(application.id, applicationId), eq(application.organizationId, orgId)),
    columns: { id: true, candidateId: true },
  })
  let tgConv: CommsConversationRow | undefined
  if (app) {
    tgConv = await db.query.commsConversation.findFirst({
      where: and(
        eq(commsConversation.organizationId, orgId),
        eq(commsConversation.channel, 'telegram'),
        eq(commsConversation.applicationId, app.id),
      ),
    })
    if (!tgConv) {
      tgConv = await db.query.commsConversation.findFirst({
        where: and(
          eq(commsConversation.organizationId, orgId),
          eq(commsConversation.channel, 'telegram'),
          eq(commsConversation.candidateId, app.candidateId),
        ),
      })
    }
  }

  const bot = await getTelegramBotForOrg(orgId)
  const telegramAvailable = Boolean(bot?.enabled)

  // Активный канал: явный запрос → hh → telegram
  let active: CommsConversationRow | null = null
  if (requestedChannel === 'telegram') active = tgConv ?? null
  else if (requestedChannel === 'hh') active = hhConv
  else active = hhConv ?? tgConv ?? null

  const channels = [hhConv, tgConv]
    .filter((c): c is CommsConversationRow => Boolean(c))
    .map(c => ({
      id: c.id,
      channel: c.channel,
      unreadCount: c.unreadCount,
      canWrite: c.canWrite,
      lastMessageAt: c.lastMessageAt?.toISOString?.() ?? null,
    }))

  if (!active) {
    return {
      conversation: null,
      messages: [],
      reason: reason ?? 'no_chat',
      channels,
      telegramAvailable,
    }
  }

  let syncError: string | null = null
  if (active.channel === 'hh') {
    try {
      await refreshHhConversation(active)
    }
    catch (err) {
      syncError = err instanceof Error ? err.message : String(err)
      logWarn('comms.refresh_failed', { conversation_id: active.id, error_message: syncError })
    }
  }

  // Перечитываем диалог после refresh (обновились can_write/счётчики)
  const fresh = await db.query.commsConversation.findFirst({
    where: (t, { eq: eqOp }) => eqOp(t.id, active!.id),
  })
  const messages = await listConversationMessages(active.id)
  // Чат 2.0: текущий черновик ассистента — чтобы генерация переживала перезагрузку страницы
  const draft = await getLatestDraft(active.id)

  // Спринт 19.5: окно ответа 24ч для чатов личного аккаунта (Telegram Business)
  const tgBizId = fresh?.tgBusinessConnectionId ?? active.tgBusinessConnectionId
  let business: { connected: boolean, canReply: boolean, windowOpen: boolean, lastInboundAt: string | null } | null = null
  if ((fresh?.channel ?? active.channel) === 'telegram' && tgBizId) {
    const bizConn = await db.query.commsTelegramBusinessConnection.findFirst({
      where: eq(commsTelegramBusinessConnection.id, tgBizId),
    })
    const lastIn = [...messages].reverse().find(m => m.direction === 'in')
    const lastInAt = lastIn ? (lastIn.externalCreatedAt ?? lastIn.createdAt) : null
    business = {
      connected: Boolean(bizConn?.enabled),
      canReply: Boolean(bizConn?.canReply),
      windowOpen: lastInAt ? (Date.now() - lastInAt.getTime()) < 24 * 60 * 60 * 1000 : false,
      lastInboundAt: lastInAt?.toISOString?.() ?? null,
    }
  }

  return {
    conversation: {
      id: fresh?.id ?? active.id,
      channel: fresh?.channel ?? active.channel,
      canWrite: fresh?.canWrite ?? active.canWrite,
      canWriteReason: fresh?.canWriteReason ?? active.canWriteReason,
      unreadCount: fresh?.unreadCount ?? active.unreadCount,
      assistantMode: fresh?.assistantMode ?? active.assistantMode,
      lastSyncedAt: fresh?.lastSyncedAt ?? null,
      business,
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
    draft,
    syncError,
    channels,
    telegramAvailable,
  }
})
