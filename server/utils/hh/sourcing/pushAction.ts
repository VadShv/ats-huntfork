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
  pipelineStage,
} from '../../../database/schema'
import { apiRequest } from '../client'
import { getValidAccessToken } from '../tokens'

/** Окно идемпотентности в миллисекундах (60 секунд). */
const IDEMPOTENCY_WINDOW_MS = 60_000

/**
 * Спринт 11.5: сообщение по умолчанию при отказе.
 * hh.ru требует обязательное сообщение кандидату при переводе в discard-коллекцию.
 * Если у этапа задан messageTemplate — используется он, иначе этот текст.
 */
export const DEFAULT_DISCARD_MESSAGE
  = 'Здравствуйте! Благодарим вас за интерес к нашей вакансии и уделённое время. '
    + 'К сожалению, сейчас мы не готовы предложить вам эту позицию. '
    + 'Мы сохраним ваше резюме в нашей базе и вернёмся к вам, если появится подходящая вакансия. '
    + 'Желаем успехов в поиске работы!'

/** Коллекции-отказы: требуют обязательное сообщение при переводе. */
const DISCARD_COLLECTIONS = new Set([
  'discard_by_employer',
  'discard_visible_by_opponent',
  'discard_after_interview',
])

/**
 * Спринт 13.2: матрица приоритетов коллекций.
 *
 * hh.ru разделяет «действие» и «состояние»: доступность перевода в коллекцию
 * зависит от тарифа работодателя и текущего состояния отклика. Поэтому мы
 * не полагаемся на статический маппинг вслепую: если hh отвечает 400/403/404
 * на целевую коллекцию, пробуем следующую по приоритету.
 */
const COLLECTION_PRIORITY: Record<string, string[]> = {
  consider: ['consider'],
  phone_interview: ['phone_interview', 'consider'],
  assessment: ['assessment', 'consider'],
  interview: ['interview', 'consider'],
  offer: ['offer', 'interview'],
  hired: ['hired', 'offer'],
  discard_by_employer: ['discard_by_employer', 'discard_after_interview', 'discard_visible_by_opponent'],
  discard_after_interview: ['discard_after_interview', 'discard_by_employer', 'discard_visible_by_opponent'],
  discard_visible_by_opponent: ['discard_visible_by_opponent', 'discard_by_employer', 'discard_after_interview'],
}

/** HTTP-статусы hh, при которых имеет смысл попробовать следующую коллекцию. */
const RETRIABLE_HH_STATUSES = new Set([400, 403, 404])

/**
 * Спринт 11.5: fallback-маппинг «тип этапа → коллекция hh.ru».
 * Работает, когда для этапа не настроен явный hh_stage_mapping.
 * null = не пушим (например, входные этапы — отклик и так уже в response).
 */
export function stageTypeToHhCollection(type: string): string | null {
  switch (type) {
    // Входные этапы — не трогаем: отклик и так лежит в response.
    case 'new':
    case 'applied':
      return null
    // Размышления / скрининг → «Подумать»
    case 'on_hold':
    case 'screening':
      return 'consider'
    // Первичный контакт → телефонное интервью
    case 'contact':
      return 'phone_interview'
    case 'assessment':
      return 'assessment'
    case 'interview':
      return 'interview'
    case 'offer':
      return 'offer'
    case 'hired':
      return 'hired'
    // Все виды отказов → отказ работодателя
    case 'rejected':
    case 'not_fit':
    case 'withdrawn':
    case 'no_show':
    case 'job_closed':
    case 'transferred':
      return 'discard_by_employer'
    // custom разбираем отдельно (по родителю), неизвестное — не пушим
    default:
      return null
  }
}

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
    columns: { id: true, hhAccountId: true, hhVacancyId: true, pushSyncEnabled: true },
  })
  if (!linkRow) return { pushed: false, reason: 'no hh vacancy link' }
  // Спринт 12.2: тумблер push-синка в настройках вакансии
  if (!linkRow.pushSyncEnabled) return { pushed: false, reason: 'push sync disabled for this link' }

  // 3. Грузим mapping для этой стадии.
  // Спринт 11.5: если явного mapping нет — используем fallback по типу этапа.
  const mapping = await db.query.hhStageMapping.findFirst({
    where: and(
      eq(hhStageMapping.hhVacancyLinkId, linkRow.id),
      eq(hhStageMapping.pipelineStageId, pipelineStageId),
      eq(hhStageMapping.organizationId, organizationId),
    ),
  })

  let targetCollection: string | null = mapping?.hhCollection ?? null
  if (!targetCollection) {
    // Fallback: определяем коллекцию по типу этапа воронки
    const stageRow = await db.query.pipelineStage.findFirst({
      where: and(
        eq(pipelineStage.id, pipelineStageId),
        eq(pipelineStage.organizationId, organizationId),
      ),
      columns: { id: true, type: true, parentStageId: true },
    })
    if (!stageRow) return { pushed: false, reason: 'stage not found' }

    let effectiveType: string = stageRow.type
    if (effectiveType === 'custom' && stageRow.parentStageId) {
      // Для кастомного подэтапа берём тип родительского этапа
      const parentRow = await db.query.pipelineStage.findFirst({
        where: eq(pipelineStage.id, stageRow.parentStageId),
        columns: { type: true },
      })
      if (parentRow) effectiveType = parentRow.type
    }
    targetCollection = stageTypeToHhCollection(effectiveType)
  }
  if (!targetCollection) return { pushed: false, reason: 'no mapping and no fallback for stage type' }

  // 4. Грузим текущую hh_negotiation, чтобы знать, нужно ли вообще двигать
  const neg = await db.query.hhNegotiation.findFirst({
    where: and(
      eq(hhNegotiation.hhNegotiationId, appRow.externalId),
      eq(hhNegotiation.organizationId, organizationId),
    ),
    columns: { id: true, hhCollection: true },
  })
  if (neg?.hhCollection === targetCollection) {
    return { pushed: false, reason: 'already in target collection' }
  }

  // 5. Идемпотентность
  const dup = await isDuplicateAction({
    organizationId,
    negotiationId: appRow.externalId,
    actionType: 'stage_change',
    targetCollection,
  })
  if (dup) return { pushed: false, reason: 'idempotent skip' }

  // 6. Спринт 13.2: динамический выбор действия — перебор коллекций по матрице.
  // Первая успешная коллекция становится итоговой. Ошибки 400/403/404 означают,
  // что перевод в эту коллекцию сейчас недоступен (тариф/состояние) — пробуем
  // следующую. Сетевые и 5xx ошибки не перебираем, чтобы не плодить действия.
  const candidates = COLLECTION_PRIORITY[targetCollection] ?? [targetCollection]
  const accessToken = await getValidAccessToken(linkRow.hhAccountId)
  const discardMessage = mapping?.messageTemplate?.trim() || DEFAULT_DISCARD_MESSAGE

  const attempts: Array<{ collection: string, status: number, error?: string }> = []
  let chosenCollection: string | null = null
  let status = 0
  let respBody: unknown = null
  let errorMsg: string | null = null

  for (const candidate of candidates) {
    const isDiscard = DISCARD_COLLECTIONS.has(candidate)
    try {
      const res = await apiRequest(
        'PUT',
        `/negotiations/${candidate}/${appRow.externalId}`,
        accessToken,
        isDiscard ? { query: { message: discardMessage } } : {},
      )
      status = res.status
      respBody = res.body
      errorMsg = null
      chosenCollection = candidate
      attempts.push({ collection: candidate, status: res.status })
      break
    } catch (err) {
      const e = err as Error & { status?: number, body?: unknown }
      status = e.status ?? 0
      respBody = e.body ?? null
      errorMsg = e.message
      attempts.push({ collection: candidate, status, error: e.message?.slice(0, 200) })
      if (!RETRIABLE_HH_STATUSES.has(status)) break
      console.warn(`[hh:pushAction] neg=${appRow.externalId} collection=${candidate} недоступна (${status}), пробуем следующую`)
    }
  }

  const finalCollection = chosenCollection ?? targetCollection
  const finalIsDiscard = DISCARD_COLLECTIONS.has(finalCollection)

  // 7. Логируем
  await db.insert(hhActionLog).values({
    organizationId,
    hhAccountId: linkRow.hhAccountId,
    performedByUserId: args.userId,
    actionType: 'stage_change',
    negotiationId: appRow.externalId,
    targetCollection: finalCollection,
    applicationId,
    requestPayload: {
      collection: finalCollection,
      requestedCollection: targetCollection,
      pipelineStageId,
      viaFallback: !mapping,
      attempts,
      ...(finalIsDiscard ? { discardMessagePreview: discardMessage.slice(0, 200) } : {}),
    } as Record<string, unknown>,
    responseStatus: status,
    responseBody: (respBody as Record<string, unknown>) ?? null,
    error: errorMsg?.slice(0, 1000) ?? null,
  })

  if (errorMsg) {
    throw new Error(errorMsg)
  }

  // Спринт 11.5: после успешного перевода фиксируем новую коллекцию локально,
  // чтобы повторные перемещения корректно скипались по «already in target».
  if (neg && chosenCollection) {
    await db.update(hhNegotiation).set({
      hhCollection: chosenCollection,
      updatedAt: new Date(),
    }).where(eq(hhNegotiation.id, neg.id))
  }

  // Если есть messageTemplate и это НЕ отказ (при отказе сообщение уже ушло в query) —
  // отправим сообщение отдельно (best-effort)
  if (mapping?.messageTemplate && !finalIsDiscard) {
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
