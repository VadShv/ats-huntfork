/**
 * Чат 2.0: фоновые задачи ИИ-ассистента переписки.
 *
 * 1. Суфлёр (suggest): генерация черновика идёт в pg-boss воркере, а не в
 *    HTTP-запросе — обновление/уход со страницы НЕ сбрасывает генерацию.
 *    Черновик живёт в comms_message: `generating` → `suggested` → `discarded`.
 * 2. Автопилот: входящее сообщение кандидата (вебхук hh) → авто-ответ от имени
 *    агента (`autopilot`) или черновик на ревью (`autopilot_review`).
 *
 * Стоп-правила автопилота (безопасность):
 *  - кандидат просит человека (handoff-фразы) → режим деградирует в copilot;
 *  - ≥5 авто-ответов подряд без вмешательства рекрутёра → вместо отправки
 *    создаётся черновик на ревью;
 *  - чат недоступен для записи / ассистент выключен / режим не автопилотный → выход.
 */
import { and, desc, eq, gt, inArray } from 'drizzle-orm'
import { commsConversation, commsMessage } from '../../database/schema'
import { getBoss } from '../queue/boss'
import { generateAssistantText, getAssistantProfile } from './assistant'
import { sendConversationMessage } from './commsService'

export const COMMS_SUGGEST_QUEUE = 'comms-assistant-suggest'
export const COMMS_AUTOPILOT_QUEUE = 'comms-assistant-autopilot'

interface SuggestJobPayload { draftId: string, conversationId: string, organizationId: string }
interface AutopilotJobPayload { conversationId: string, organizationId: string }

type ConversationRow = typeof commsConversation.$inferSelect
type MessageRow = typeof commsMessage.$inferSelect

/** Свежесть: generating-черновик младше 3 мин считаем «ещё в работе». */
const GENERATING_FRESH_MS = 3 * 60 * 1000
/** Черновики старше 30 мин не показываем — контекст мог устареть. */
const DRAFT_TTL_MS = 30 * 60 * 1000
/** Стоп-правило: максимум авто-ответов подряд без участия человека. */
const AUTOPILOT_MAX_STREAK = 5

/** Кандидат просит живого человека — автопилот обязан отойти в сторону. */
const HANDOFF_RE = /(позовите|позвать|соедините|переключите|живо(й|го|му)\s+человек|с\s+человеком|не\s+бот|вы\s+бот|хватит\s+бот|оператор|менеджер[ау]?\s*,?\s*пожалуйста)/i

export interface AssistantDraft {
  id: string
  status: 'generating' | 'suggested'
  body: string | null
  senderName: string | null
  errorMessage: string | null
  createdAt: Date
}

function toDraft(m: MessageRow): AssistantDraft {
  return {
    id: m.id,
    status: m.status as 'generating' | 'suggested',
    body: m.body,
    senderName: m.senderName,
    errorMessage: m.errorMessage,
    createdAt: m.createdAt,
  }
}

/** Последний живой черновик агента в диалоге (generating | suggested, не старше TTL). */
export async function getLatestDraft(conversationId: string): Promise<AssistantDraft | null> {
  const cutoff = new Date(Date.now() - DRAFT_TTL_MS)
  const row = await db.query.commsMessage.findFirst({
    where: and(
      eq(commsMessage.conversationId, conversationId),
      eq(commsMessage.senderType, 'agent'),
      inArray(commsMessage.status, ['generating', 'suggested']),
      gt(commsMessage.createdAt, cutoff),
    ),
    orderBy: [desc(commsMessage.createdAt)],
  })
  if (!row) return null
  // Протухший generating (воркер умер) — тихо списываем
  if (row.status === 'generating' && row.createdAt.getTime() < Date.now() - GENERATING_FRESH_MS) {
    await db.update(commsMessage)
      .set({ status: 'discarded', errorMessage: 'generation_stalled', updatedAt: new Date() })
      .where(and(eq(commsMessage.id, row.id), eq(commsMessage.status, 'generating')))
    return null
  }
  return toDraft(row)
}

/**
 * Идемпотентный запрос черновика: если генерация уже идёт — возвращаем её,
 * иначе создаём generating-строку и ставим задачу воркеру.
 */
export async function requestSuggestDraft(conv: ConversationRow, orgId: string): Promise<AssistantDraft> {
  const existing = await getLatestDraft(conv.id)
  if (existing) return existing

  const inserted = await db.insert(commsMessage)
    .values({
      organizationId: orgId,
      conversationId: conv.id,
      direction: 'out',
      senderType: 'agent',
      status: 'generating',
      body: null,
    })
    .returning()
  const draft = inserted[0]!

  try {
    const boss = await getBoss()
    await boss.send(COMMS_SUGGEST_QUEUE, {
      draftId: draft.id,
      conversationId: conv.id,
      organizationId: orgId,
    } satisfies SuggestJobPayload, {
      retryLimit: 1,
      retryDelay: 5,
      expireInSeconds: 240,
    })
  }
  catch (err) {
    // Очередь недоступна — деградируем в фоновую генерацию в этом же процессе
    logWarn('comms.suggest_enqueue_failed_inline_fallback', {
      conversation_id: conv.id,
      error_message: err instanceof Error ? err.message : String(err),
    })
    void runSuggestJob(draft.id, conv.id, orgId)
  }
  return toDraft(draft)
}

/** Генерация черновика (тело фоновой задачи). Обновляет строку черновика по результату. */
export async function runSuggestJob(draftId: string, conversationId: string, orgId: string): Promise<void> {
  const conv = await db.query.commsConversation.findFirst({
    where: eq(commsConversation.id, conversationId),
  })
  if (!conv) return
  try {
    const { text, personaName } = await generateAssistantText(conv, orgId)
    // Условный update: если черновик уже отклонили (отмена) — не воскрешаем
    const updated = await db.update(commsMessage)
      .set({ body: text, senderName: personaName, status: 'suggested', updatedAt: new Date() })
      .where(and(eq(commsMessage.id, draftId), eq(commsMessage.status, 'generating')))
      .returning({ id: commsMessage.id })
    if (!updated.length) {
      logInfo('comms.suggest_draft_cancelled', { draft_id: draftId, conversation_id: conversationId })
    }
  }
  catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await db.update(commsMessage)
      .set({ status: 'discarded', errorMessage: `generation_failed: ${msg}`.slice(0, 500), updatedAt: new Date() })
      .where(and(eq(commsMessage.id, draftId), eq(commsMessage.status, 'generating')))
    logError('comms.suggest_failed', { draft_id: draftId, conversation_id: conversationId, error_message: msg })
  }
}

/** pg-boss 10 передаёт массив джобов. */
export async function processSuggestJob(jobs: { data: SuggestJobPayload } | { data: SuggestJobPayload }[]): Promise<void> {
  const list = Array.isArray(jobs) ? jobs : [jobs]
  for (const job of list) {
    const { draftId, conversationId, organizationId } = job.data
    await runSuggestJob(draftId, conversationId, organizationId)
  }
}

// ─────────────────────────── Автопилот ───────────────────────────

/**
 * Триггер автопилота после ингеста входящего сообщения (зовётся из вебхука).
 * Лёгкие проверки здесь, тяжёлая работа — в очереди (singleton схлопывает дубли).
 */
export async function maybeTriggerAutopilot(conversationId: string): Promise<void> {
  const conv = await db.query.commsConversation.findFirst({
    where: eq(commsConversation.id, conversationId),
  })
  if (!conv) return
  if (conv.assistantMode !== 'autopilot' && conv.assistantMode !== 'autopilot_review') return
  if (!conv.canWrite) return

  const profile = await getAssistantProfile(conv.organizationId)
  if (!profile?.enabled || !profile.aiConfigId) return

  const last = await lastContentMessage(conv.id)
  if (!last || last.direction !== 'in') return

  // Стоп-правило: кандидат просит человека → деградация в суфлёра
  if (last.body && HANDOFF_RE.test(last.body)) {
    await db.update(commsConversation)
      .set({ assistantMode: 'copilot', updatedAt: new Date() })
      .where(eq(commsConversation.id, conv.id))
    logInfo('comms.autopilot_handoff', { conversation_id: conv.id, reason: 'candidate_requested_human' })
    return
  }

  const boss = await getBoss()
  await boss.send(COMMS_AUTOPILOT_QUEUE, {
    conversationId: conv.id,
    organizationId: conv.organizationId,
  } satisfies AutopilotJobPayload, {
    retryLimit: 1,
    retryDelay: 10,
    expireInSeconds: 240,
    singletonKey: `autopilot:${conv.id}`,
    singletonSeconds: 20,
  })
}

/** Последнее содержательное сообщение ленты (без черновиков агента). */
async function lastContentMessage(conversationId: string): Promise<MessageRow | undefined> {
  return db.query.commsMessage.findFirst({
    where: and(
      eq(commsMessage.conversationId, conversationId),
      inArray(commsMessage.status, ['received', 'sent', 'pending']),
    ),
    orderBy: [desc(commsMessage.externalCreatedAt), desc(commsMessage.createdAt)],
  })
}

/** Сколько авто-ответов подряд после последнего сообщения человека-рекрутёра. */
async function agentStreak(conversationId: string): Promise<number> {
  const recent = await db.select({
    direction: commsMessage.direction,
    senderType: commsMessage.senderType,
    status: commsMessage.status,
  })
    .from(commsMessage)
    .where(and(
      eq(commsMessage.conversationId, conversationId),
      inArray(commsMessage.status, ['received', 'sent', 'pending']),
    ))
    .orderBy(desc(commsMessage.externalCreatedAt), desc(commsMessage.createdAt))
    .limit(30)

  let streak = 0
  for (const m of recent) {
    if (m.direction !== 'out') continue // входящие кандидата не прерывают серию
    if (m.senderType === 'agent') {
      streak += 1
      continue
    }
    break // человек (recruiter/system) вмешался — серия прервана
  }
  return streak
}

export async function processAutopilotJob(jobs: { data: AutopilotJobPayload } | { data: AutopilotJobPayload }[]): Promise<void> {
  const list = Array.isArray(jobs) ? jobs : [jobs]
  for (const job of list) {
    await runAutopilotJob(job.data)
  }
}

async function runAutopilotJob({ conversationId, organizationId }: AutopilotJobPayload): Promise<void> {
  const conv = await db.query.commsConversation.findFirst({
    where: eq(commsConversation.id, conversationId),
  })
  if (!conv) return
  // Перепроверка на актуальных данных (режим могли выключить, чат — закрыться)
  if (conv.assistantMode !== 'autopilot' && conv.assistantMode !== 'autopilot_review') return
  if (!conv.canWrite) return

  // Последнее сообщение всё ещё от кандидата? (гонка: рекрутёр мог ответить сам)
  const last = await lastContentMessage(conv.id)
  if (!last || last.direction !== 'in') return

  // Уже есть живой черновик/генерация — не плодим дубли
  const existingDraft = await getLatestDraft(conv.id)
  if (existingDraft) return

  // Стоп-правило: слишком длинная серия авто-ответов → только ревью
  const streak = await agentStreak(conv.id)
  const forceReview = streak >= AUTOPILOT_MAX_STREAK
  if (forceReview) {
    logWarn('comms.autopilot_streak_limit', { conversation_id: conv.id, streak })
  }

  try {
    const { text, personaName } = await generateAssistantText(conv, organizationId, { autopilot: true })

    if (conv.assistantMode === 'autopilot' && !forceReview) {
      await sendConversationMessage(conv, {
        userId: null,
        userName: null,
        text,
        senderType: 'agent',
        senderName: personaName,
      })
      logInfo('comms.autopilot_sent', { conversation_id: conv.id, streak: streak + 1 })
    }
    else {
      // autopilot_review или деградация по стоп-правилу — черновик на ревью
      await db.insert(commsMessage).values({
        organizationId,
        conversationId: conv.id,
        direction: 'out',
        senderType: 'agent',
        senderName: personaName,
        body: text,
        status: 'suggested',
      })
      logInfo('comms.autopilot_review_draft', { conversation_id: conv.id, force_review: forceReview })
    }
  }
  catch (err) {
    logError('comms.autopilot_failed', {
      conversation_id: conv.id,
      error_message: err instanceof Error ? err.message : String(err),
    })
  }
}
