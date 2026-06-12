/**
 * Push-действия на hh.ru.
 *
 * Когда application переезжает между стадиями в нашей воронке, мы (опционально)
 * выполняем соответствующее действие в hh.ru:
 *   1. Переводим negotiation в нужную коллекцию (PUT /negotiations/{collection}).
 *   2. Если в mapping задан messageTemplate — отправляем сообщение работодателя.
 *
 * Идемпотентность:
 *   - Перед каждым действием смотрим hh_action_log: было ли точно такое же действие
 *     по (negotiationId + actionType + targetCollection) за последние 60 секунд? Если да — пропускаем.
 *
 * Безопасность:
 *   - При любой ошибке логируем в hh_action_log с error-полем и пробрасываем дальше.
 *   - Никогда не блокируем основной flow (вызывающий код ловит ошибку и логирует, но не падает).
 */
import { and, eq, gte } from 'drizzle-orm'
import {
  application,
  hhActionLog,
  hhNegotiation,
  hhStageMapping,
  hhVacancyLink,
} from '../../../database/schema'
import { apiRequest } from '../client'
import { getValidAccessToken } from '../tokens'

/** Окно идемпотентности в миллисекундах (60 секунд). */
const IDEMPOTENCY_WINDOW_MS = 60_000

/**
 * Проверить, было ли точно такое же действие за последние N миллисекунд.
 * Это защита от двойного нажатия, повторных webhook-вызовов и пр.
 */
async function isDuplicateAction(args: {
  organizationId: string
  negotiationId: string
  actionType: string
  targetCollection?: string | null
}): Promise<boolean> {
  const cutoff = new Date(Date.now() - IDEMPOTENCY_WINDOW_MS)
  const conditions = [
    eq(hhActionLog.organizationId, args.organizationId),
    eq(hhActionLog.negotiationId, args.negotiationId),
    eq(hhActionLog.actionType, args.actionType),
    gte(hhActionLog.createdAt, cutoff),
  ]
  if (args.targetCollection) {
    conditions.push(eq(hhActionLog.targetCollection, args.targetCollection))
  }
  const recent = await db
    .select({ id: hhActionLog.id })
    .from(hhActionLog)
    .where(and(...conditions))
    .limit(1)
  return recent.length > 0
}

/**
 * Перевести application в hh-коллекцию согласно mapping.
 *
 * Возвращает true если действие выполнено, false если пропущено (нет mapping
 * или нет hh-связки или нет hh-negotiation).
 */
export async function pushStageChangeToHh(args: {
  organizationId: string
  applicationId: string
  pipelineStageId: string
  userId: string | null
}): Promise<{ pushed: boolean, reason?: string }> {
  const { organizationId, applicationId, pipelineStageId } = args

  // 1. Грузим application + hh-negotiation
  const appRow = await db.query.application.findFirst({
    where: and(eq(application.id, applicationId), eq(application.organizationId, organizationId)),
    columns: { id: true, jobId: true, externalId: true, source: true },
  })
  if (!appRow) return { pushed: false, reason: 'application not found' }
  if (appRow.source !== 'hh' && appRow.source !== 'hh_sourcing') {
    return { pushed: false, reason: 'not an hh application' }
  }
  if (!appRow.externalId) return { pushed: false, reason: 'no hh negotiation id' }

  // 2. Грузим hh_vacancy_link для job
  const linkRow = await db.query.hhVacancyLink.findFirst({
    where: and(
      eq(hhVacancyLink.jobId, appRow.jobId),
      eq(hhVacancyLink.organizationId, organizationId),
    ),
    columns: { id: true, hhAccountId: true, hhVacancyId: true },
  })
  if (!linkRow) return { pushed: false, reason: 'no hh vacancy link' }

  // 3. Грузим mapping для этой стадии
  const mapping = await db.query.hhStageMapping.findFirst({
    where: and(
      eq(hhStageMapping.hhVacancyLinkId, linkRow.id),
      eq(hhStageMapping.pipelineStageId, pipelineStageId),
      eq(hhStageMapping.organizationId, organizationId),
    ),
  })
  if (!mapping) return { pushed: false, reason: 'no stage mapping' }

  // 4. Грузим текущую hh_negotiation, чтобы знать, нужно ли вообще двигать
  const neg = await db.query.hhNegotiation.findFirst({
    where: and(
      eq(hhNegotiation.hhNegotiationId, appRow.externalId),
      eq(hhNegotiation.organizationId, organizationId),
    ),
    columns: { id: true, hhCollection: true },
  })
  if (neg?.hhCollection === mapping.hhCollection) {
    return { pushed: false, reason: 'already in target collection' }
  }

  // 5. Идемпотентность
  const dup = await isDuplicateAction({
    organizationId,
    negotiationId: appRow.externalId,
    actionType: 'stage_change',
    targetCollection: mapping.hhCollection,
  })
  if (dup) return { pushed: false, reason: 'idempotent skip' }

  // 6. Делаем PUT в hh
  const accessToken = await getValidAccessToken(linkRow.hhAccountId)
  let status = 0
  let respBody: unknown = null
  let errorMsg: string | null = null
  try {
    const res = await apiRequest(
      'PUT',
      `/negotiations/${mapping.hhCollection}`,
      accessToken,
      { body: { topic: appRow.externalId }, contentType: 'form' },
    )
    status = res.status
    respBody = res.body
  } catch (err) {
    const e = err as Error & { status?: number, body?: unknown }
    errorMsg = e.message
    status = e.status ?? 0
    respBody = e.body ?? null
  }

  // 7. Логируем
  await db.insert(hhActionLog).values({
    organizationId,
    hhAccountId: linkRow.hhAccountId,
    performedByUserId: args.userId,
    actionType: 'stage_change',
    negotiationId: appRow.externalId,
    targetCollection: mapping.hhCollection,
    applicationId,
    requestPayload: {
      collection: mapping.hhCollection,
      pipelineStageId,
    } as Record<string, unknown>,
    responseStatus: status,
    responseBody: (respBody as Record<string, unknown>) ?? null,
    error: errorMsg?.slice(0, 1000) ?? null,
  })

  if (errorMsg) {
    throw new Error(errorMsg)
  }

  // Если есть messageTemplate — попробуем отправить сообщение (best-effort)
  if (mapping.messageTemplate) {
    try {
      await sendNegotiationMessage({
        organizationId,
        hhAccountId: linkRow.hhAccountId,
        negotiationId: appRow.externalId,
        messageText: mapping.messageTemplate,
        userId: args.userId,
        applicationId,
      })
    } catch (err) {
      console.warn('[hh:pushAction] send message failed', err)
    }
  }

  return { pushed: true }
}

/**
 * Отправить сообщение по negotiation от лица работодателя.
 *
 * POST /negotiations/{nid}/messages
 * Body: { text: string }
 */
export async function sendNegotiationMessage(args: {
  organizationId: string
  hhAccountId: string
  negotiationId: string
  messageText: string
  userId: string | null
  applicationId?: string | null
}): Promise<{ sent: boolean }> {
  // Идемпотентность по тексту в окне 60с
  const dup = await isDuplicateAction({
    organizationId: args.organizationId,
    negotiationId: args.negotiationId,
    actionType: 'send_message',
  })
  if (dup) return { sent: false }

  const accessToken = await getValidAccessToken(args.hhAccountId)
  let status = 0
  let respBody: unknown = null
  let errorMsg: string | null = null
  try {
    const res = await apiRequest(
      'POST',
      `/negotiations/${args.negotiationId}/messages`,
      accessToken,
      { body: { message: args.messageText }, contentType: 'form' },
    )
    status = res.status
    respBody = res.body
  } catch (err) {
    const e = err as Error & { status?: number, body?: unknown }
    errorMsg = e.message
    status = e.status ?? 0
    respBody = e.body ?? null
  }

  await db.insert(hhActionLog).values({
    organizationId: args.organizationId,
    hhAccountId: args.hhAccountId,
    performedByUserId: args.userId,
    actionType: 'send_message',
    negotiationId: args.negotiationId,
    applicationId: args.applicationId ?? null,
    requestPayload: {
      messagePreview: args.messageText.slice(0, 200),
    } as Record<string, unknown>,
    responseStatus: status,
    responseBody: (respBody as Record<string, unknown>) ?? null,
    error: errorMsg?.slice(0, 1000) ?? null,
  })

  if (errorMsg) throw new Error(errorMsg)
  return { sent: true }
}
