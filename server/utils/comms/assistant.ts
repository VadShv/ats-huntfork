/**
 * AI-ассистент в переписке (Спринт 18.5, режим «суфлёр»).
 *
 * Собирает промпт из профиля ассистента (персона, тон, база знаний, правила),
 * карточки вакансии/кандидата и истории диалога, зовёт LLM через отдельный
 * AI-конфиг (НЕ скрининговый) и сохраняет черновик как comms_message со
 * статусом `suggested` — для аудита и задела под автопилот (18.6).
 */
import { desc, eq } from 'drizzle-orm'
import { generateText } from 'ai'
import {
  aiConfig,
  commsAssistantProfile,
  commsConversation,
  commsMessage,
} from '../../database/schema'
import { createLanguageModel, type SupportedProvider } from '../ai/provider'

type ConversationRow = typeof commsConversation.$inferSelect
type ProfileRow = typeof commsAssistantProfile.$inferSelect

const TONE_HINTS: Record<string, string> = {
  formal: 'Тон: строго деловой, на «Вы», без эмодзи.',
  neutral: 'Тон: нейтрально-профессиональный, вежливый, без лишней воды.',
  friendly: 'Тон: дружелюбный и тёплый, но профессиональный. Уместны лёгкие неформальности.',
}

/** Профиль ассистента организации (или null, если ещё не настроен). */
export function getAssistantProfile(orgId: string): Promise<ProfileRow | undefined> {
  return db.query.commsAssistantProfile.findFirst({
    where: eq(commsAssistantProfile.organizationId, orgId),
  })
}

/** Грубая зачистка HTML для вставки описания вакансии в промпт. */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Генерация черновика ответа рекрутёра на последнее сообщение кандидата.
 * Возвращает текст черновика; параллельно пишет suggested-запись в comms_message.
 */
export async function suggestReply(conv: ConversationRow, orgId: string): Promise<{ text: string, messageId: string }> {
  const profile = await getAssistantProfile(orgId)
  if (!profile || !profile.enabled) {
    throw createError({ statusCode: 400, statusMessage: 'Ассистент не настроен', data: { code: 'assistant_disabled' } })
  }
  if (!profile.aiConfigId) {
    throw createError({ statusCode: 400, statusMessage: 'У ассистента нет конфигурации ИИ', data: { code: 'assistant_no_config' } })
  }
  const cfg = await db.query.aiConfig.findFirst({
    where: eq(aiConfig.id, profile.aiConfigId),
  })
  if (!cfg || cfg.organizationId !== orgId) {
    throw createError({ statusCode: 400, statusMessage: 'Конфигурация ИИ ассистента не найдена', data: { code: 'assistant_no_config' } })
  }

  // ── Контекст: кандидат, вакансия, история ──
  const [candidate, job, history] = await Promise.all([
    conv.candidateId
      ? db.query.candidate.findFirst({ where: (t, { eq: e }) => e(t.id, conv.candidateId!) })
      : Promise.resolve(undefined),
    conv.jobId
      ? db.query.job.findFirst({ where: (t, { eq: e }) => e(t.id, conv.jobId!) })
      : Promise.resolve(undefined),
    db.select()
      .from(commsMessage)
      .where(eq(commsMessage.conversationId, conv.id))
      .orderBy(desc(commsMessage.externalCreatedAt), desc(commsMessage.createdAt))
      .limit(30),
  ])

  const candidateName = candidate
    ? (candidate.displayName || `${candidate.firstName} ${candidate.lastName}`.trim())
    : null

  const dialogue = history
    .filter(m => m.status !== 'suggested' && m.status !== 'discarded' && (m.body ?? '').trim())
    .reverse()
    .map(m => `${m.direction === 'in' ? 'Кандидат' : 'Рекрутер'}: ${(m.body ?? '').trim()}`)
    .join('\n')

  const personaName = profile.personaName?.trim() || 'Ассистент рекрутера'
  const personaRole = profile.personaRole?.trim() || 'ИИ-ассистент команды подбора'
  const lang = profile.language === 'en' ? 'английском' : 'русском'

  const systemParts = [
    `Ты — ${personaName}, ${personaRole}. Ты готовишь ЧЕРНОВИК ответа рекрутёра кандидату в чате по вакансии.`,
    TONE_HINTS[profile.tone] ?? TONE_HINTS.neutral,
    `Пиши на ${lang} языке.`,
    'Требования к ответу: только текст сообщения без пояснений, приветствие уместно только если диалог только начался, не выдумывай факты — если информации нет в контексте, вежливо скажи, что уточнишь у команды.',
    profile.rules?.trim() ? `Правила и ограничения (соблюдай строго):\n${profile.rules.trim()}` : '',
    profile.knowledgeBase?.trim() ? `База знаний организации:\n${profile.knowledgeBase.trim()}` : '',
  ].filter(Boolean)

  const contextParts = [
    job ? `Вакансия: ${job.title}${job.location ? ` (${job.location})` : ''}` : '',
    job?.description ? `Описание вакансии: ${stripHtml(job.description).slice(0, 2000)}` : '',
    candidateName ? `Кандидат: ${candidateName}` : '',
    dialogue ? `История диалога (последние сообщения):\n${dialogue}` : 'Диалог пока пуст — подготовь первое сообщение кандидату по вакансии.',
    'Подготовь следующий ответ рекрутёра.',
  ].filter(Boolean)

  const model = createLanguageModel({
    provider: cfg.provider as SupportedProvider,
    model: cfg.model,
    apiKeyEncrypted: cfg.apiKeyEncrypted,
    baseUrl: cfg.baseUrl,
    maxTokens: Math.min(cfg.maxTokens, 1024),
  })

  const started = Date.now()
  const result = await generateText({
    model,
    system: systemParts.join('\n\n'),
    prompt: contextParts.join('\n\n'),
    temperature: 0.4,
  })
  const text = result.text.trim()
  if (!text) {
    throw createError({ statusCode: 502, statusMessage: 'Ассистент вернул пустой черновик' })
  }

  const [row] = await db.insert(commsMessage).values({
    organizationId: orgId,
    conversationId: conv.id,
    direction: 'out',
    senderType: 'agent',
    senderName: personaName,
    body: text,
    status: 'suggested',
  }).returning({ id: commsMessage.id })

  logInfo('comms.assistant_suggest', {
    conversation_id: conv.id,
    model: cfg.model,
    provider: cfg.provider,
    duration_ms: Date.now() - started,
    input_tokens: result.usage?.inputTokens ?? null,
    output_tokens: result.usage?.outputTokens ?? null,
  })

  return { text, messageId: row!.id }
}
