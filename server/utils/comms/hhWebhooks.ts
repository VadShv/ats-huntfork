/**
 * Спринт 18.1 — обработка вебхуков hh.ru.
 *
 * Поток:
 *   hh.ru → POST /api/webhooks/hh/{secret}  (быстрый ACK, журнал comms_channel_event)
 *        → pg-boss очередь HH_WEBHOOK_QUEUE → processHhWebhookJob()
 *
 * Обрабатываемые события (подписка оформляется в /api/hh/webhooks.post):
 *   - CHAT_MESSAGE_CREATED               → refreshHhConversation (мгновенный ингест сообщения)
 *   - NEW_RESPONSE_OR_INVITATION_VACANCY → дебаунс-синк вакансии (импорт нового отклика)
 *   - NEGOTIATION_EMPLOYER_STATE_CHANGE  → дебаунс-синк вакансии (синхронизация статусов)
 *
 * ВАЖНО: вебхуки hh — «ускоритель», не гарантированная доставка.
 * Существующий sync-on-read и ручной синк остаются фолбэком.
 */
import { and, eq } from 'drizzle-orm'
import { commsChannelEvent, commsConversation, hhVacancyLink } from '../../database/schema'
import { getBoss } from '../queue/boss'
import { refreshHhConversation } from './commsService'
import { syncVacancyLink } from '../hh/sync'

export const HH_WEBHOOK_QUEUE = 'comms-hh-webhook'
export const HH_WEBHOOK_SYNC_QUEUE = 'comms-hh-webhook-sync'

export interface HhWebhookJobPayload { eventRowId: string }
export interface HhWebhookSyncPayload { linkId: string }

/** Конверт события hh (WebhookSendObjectBaseUser). */
export interface HhWebhookEnvelope {
  id?: string
  subscription_id?: string
  action_type?: string
  payload?: Record<string, unknown>
}

/**
 * Поставить событие в очередь обработки. Best-effort: при недоступности
 * очереди логируем и возвращаем false — событие останется в журнале
 * со статусом received и не потеряется (можно добить вручную/фолбэком).
 */
export async function enqueueHhWebhookEvent(eventRowId: string): Promise<boolean> {
  try {
    const boss = await getBoss()
    await boss.send(HH_WEBHOOK_QUEUE, { eventRowId } satisfies HhWebhookJobPayload, {
      retryLimit: 3,
      retryDelay: 20,
      retryBackoff: true,
      expireInSeconds: 5 * 60,
    })
    return true
  }
  catch (err) {
    logError('comms.hh_webhook_enqueue_failed', {
      event_row_id: eventRowId,
      error_message: err instanceof Error ? err.message : String(err),
      module: 'comms',
    })
    return false
  }
}

/** Пометить событие обработанным/пропущенным/упавшим. */
async function finishEvent(id: string, status: 'processed' | 'skipped' | 'failed', errorMessage?: string): Promise<void> {
  await db.update(commsChannelEvent)
    .set({ status, errorMessage: errorMessage ?? null, processedAt: new Date() })
    .where(eq(commsChannelEvent.id, id))
}

/**
 * Дебаунс-синк вакансии: не чаще одного раза в 60 секунд на связку
 * (singletonKey + singletonSeconds в pg-boss схлопывают шквал событий).
 */
async function enqueueLinkSync(linkId: string): Promise<void> {
  const boss = await getBoss()
  await boss.send(HH_WEBHOOK_SYNC_QUEUE, { linkId } satisfies HhWebhookSyncPayload, {
    retryLimit: 2,
    retryDelay: 60,
    retryBackoff: true,
    expireInSeconds: 10 * 60,
    singletonKey: `whsync:${linkId}`,
    singletonSeconds: 60,
  })
}

/**
 * Воркер событий вебхука. В pg-boss 10 handler получает МАССИВ джобов —
 * принимаем оба варианта для надёжности.
 */
export async function processHhWebhookJob(
  input: { data: HhWebhookJobPayload } | Array<{ data: HhWebhookJobPayload }>,
): Promise<void> {
  const jobs = Array.isArray(input) ? input : [input]
  for (const job of jobs) {
    await processOneWebhookEvent(job.data)
  }
}

async function processOneWebhookEvent(data: HhWebhookJobPayload): Promise<void> {
  const { eventRowId } = data
  const row = await db.query.commsChannelEvent.findFirst({
    where: eq(commsChannelEvent.id, eventRowId),
  })
  if (!row) return
  if (row.status === 'processed' || row.status === 'skipped') return // уже обработано

  const envelope = (row.payload ?? {}) as HhWebhookEnvelope
  const payload = (envelope.payload ?? {}) as Record<string, unknown>

  try {
    switch (row.type) {
      case 'CHAT_MESSAGE_CREATED': {
        const chatId = typeof payload.chat_id === 'string' ? payload.chat_id : null
        const messageType = typeof payload.message_type === 'string' ? payload.message_type : 'SIMPLE'
        if (!chatId || messageType !== 'SIMPLE') {
          await finishEvent(row.id, 'skipped', !chatId ? 'no_chat_id' : `message_type=${messageType}`)
          return
        }
        const conv = await db.query.commsConversation.findFirst({
          where: and(
            eq(commsConversation.organizationId, row.organizationId),
            eq(commsConversation.channel, 'hh'),
            eq(commsConversation.externalChatId, chatId),
          ),
        })
        if (!conv) {
          // Диалог ещё не создан в системе — создастся лениво при открытии чата,
          // а сообщение подтянется тем же refresh. Ничего не теряем.
          await finishEvent(row.id, 'skipped', 'no_conversation')
          return
        }
        await refreshHhConversation(conv)
        await finishEvent(row.id, 'processed')
        logInfo('comms.hh_webhook_chat_refreshed', {
          conversation_id: conv.id,
          organization_id: row.organizationId,
          module: 'comms',
        })
        return
      }

      case 'NEW_RESPONSE_OR_INVITATION_VACANCY':
      case 'NEGOTIATION_EMPLOYER_STATE_CHANGE': {
        const vacancyId = payload.vacancy_id != null ? String(payload.vacancy_id) : null
        if (!vacancyId) {
          await finishEvent(row.id, 'skipped', 'no_vacancy_id')
          return
        }
        const link = await db.query.hhVacancyLink.findFirst({
          where: and(
            eq(hhVacancyLink.organizationId, row.organizationId),
            eq(hhVacancyLink.hhVacancyId, vacancyId),
          ),
          columns: { id: true, autoSyncEnabled: true },
        })
        if (!link || !link.autoSyncEnabled) {
          await finishEvent(row.id, 'skipped', !link ? 'no_vacancy_link' : 'auto_sync_disabled')
          return
        }
        await enqueueLinkSync(link.id)
        await finishEvent(row.id, 'processed')
        return
      }

      default:
        await finishEvent(row.id, 'skipped', `unhandled_type=${row.type}`)
    }
  }
  catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await finishEvent(row.id, 'failed', msg.slice(0, 500))
    logError('comms.hh_webhook_job_failed', {
      event_row_id: row.id,
      event_type: row.type,
      error_message: msg,
      module: 'comms',
    })
    throw err // pg-boss ретраит; статус восстановится в processed при успехе
  }
}

/** Воркер дебаунс-синка вакансии (также толерантен к массиву джобов). */
export async function processHhWebhookSyncJob(
  input: { data: HhWebhookSyncPayload } | Array<{ data: HhWebhookSyncPayload }>,
): Promise<void> {
  const jobs = Array.isArray(input) ? input : [input]
  for (const job of jobs) {
    await processOneSync(job.data)
  }
}

async function processOneSync(data: HhWebhookSyncPayload): Promise<void> {
  const { linkId } = data
  const startedAt = Date.now()
  try {
    const result = await syncVacancyLink(linkId)
    logInfo('comms.hh_webhook_sync_completed', {
      link_id: linkId,
      imported: (result as { imported?: number }).imported ?? null,
      duration_ms: Date.now() - startedAt,
      module: 'comms',
    })
  }
  catch (err) {
    logError('comms.hh_webhook_sync_failed', {
      link_id: linkId,
      error_message: err instanceof Error ? err.message : String(err),
      module: 'comms',
    })
    throw err
  }
}
