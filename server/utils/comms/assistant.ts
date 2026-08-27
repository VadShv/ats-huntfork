/**
 * AI-ассистент в переписке (Спринт 18.5 «суфлёр», Чат 2.0 — фоновая генерация и автопилот).
 *
 * Ядро генерации: собирает промпт из глобального профиля ассистента
 * (персона, тон, база знаний, правила), настроек ИИ-чата конкретной вакансии
 * (цели общения, доп. контекст, переопределение тона), карточки
 * вакансии/кандидата и истории диалога, зовёт LLM через отдельный AI-конфиг
 * (НЕ скрининговый). Черновики живут в comms_message: status `generating`
 * (в работе) → `suggested` (готов) → `discarded` (использован/отклонён).
 */
import { desc, eq } from 'drizzle-orm'
import { generateText } from 'ai'
import {
  aiConfig,
  commsAssistantProfile,
  commsConversation,
  commsJobAssistantSettings,
  commsMessage,
} from '../../database/schema'
import { createLanguageModel, type SupportedProvider } from '../ai/provider'

type ConversationRow = typeof commsConversation.$inferSelect
type ProfileRow = typeof commsAssistantProfile.$inferSelect
type JobSettingsRow = typeof commsJobAssistantSettings.$inferSelect

const TONE_HINTS: Record<string, string> = {
  formal: 'Тон: строго деловой, на «Вы», без эмодзи.',
  neutral: 'Тон: нейтрально-профессиональный, вежливый, без лишней воды.',
  friendly: 'Тон: дружелюбный и тёплый, но профессиональный. Уместны лёгкие неформальности.',
}

/** Чат 2.0: скорость — ужатый контекст и потолок ответа.
 * ВАЖНО: бюджет токенов должен вмещать «размышления» reasoning-моделей
 * (Qwen3.5 и подобные сначала генерируют reasoning_content и только потом
 * видимый ответ). При малом лимите весь бюджет уходит на размышления
 * и текст приходит пустым. Короткий видимый ответ обеспечивает промпт
 * («1-4 предложения»), а не лимит: обычные модели останавливаются сами. */
const HISTORY_LIMIT = 15
const JOB_DESCRIPTION_LIMIT = 1000
const MAX_OUTPUT_TOKENS = 4096
const GENERATION_TIMEOUT_MS = 150_000

/**
 * Чат 2.0: зачистка ответа reasoning-моделей.
 * Некоторые сервера отдают размышления прямо в content блоками <think>…</think> —
 * кандидату их видеть нельзя. Берём только текст после последнего </think>;
 * незакрытый <think> (оборванные по лимиту размышления) отбрасываем целиком.
 */
function extractVisibleText(raw: string): string {
  let text = raw
  const lastClose = text.lastIndexOf('</think>')
  if (lastClose !== -1) {
    text = text.slice(lastClose + '</think>'.length)
  }
  else {
    const openIdx = text.indexOf('<think>')
    if (openIdx !== -1) text = text.slice(0, openIdx)
  }
  return text.trim()
}

/** Профиль ассистента организации (или null, если ещё не настроен). */
export function getAssistantProfile(orgId: string): Promise<ProfileRow | undefined> {
  return db.query.commsAssistantProfile.findFirst({
    where: eq(commsAssistantProfile.organizationId, orgId),
  })
}

/** Чат 2.0: настройки ИИ-чата конкретной вакансии (или undefined). */
export function getJobAssistantSettings(jobId: string): Promise<JobSettingsRow | undefined> {
  return db.query.commsJobAssistantSettings.findFirst({
    where: eq(commsJobAssistantSettings.jobId, jobId),
  })
}

/** Проверка «ассистент готов к работе» — общий гейт для суфлёра и автопилота. */
export async function requireAssistantConfig(orgId: string): Promise<{ profile: ProfileRow, cfg: typeof aiConfig.$inferSelect }> {
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
  return { profile, cfg }
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
 * Ядро генерации ответа ассистента (без записи в БД).
 * Используется фоновым воркером суфлёра и автопилотом.
 */
export async function generateAssistantText(
  conv: ConversationRow,
  orgId: string,
  opts: { autopilot?: boolean } = {},
): Promise<{ text: string, personaName: string, model: string, provider: string, durationMs: number }> {
  const { profile, cfg } = await requireAssistantConfig(orgId)

  // ── Контекст: кандидат, вакансия, настройки вакансии, история ──
  const [candidate, job, jobSettings, history] = await Promise.all([
    conv.candidateId
      ? db.query.candidate.findFirst({ where: (t, { eq: e }) => e(t.id, conv.candidateId!) })
      : Promise.resolve(undefined),
    conv.jobId
      ? db.query.job.findFirst({ where: (t, { eq: e }) => e(t.id, conv.jobId!) })
      : Promise.resolve(undefined),
    conv.jobId ? getJobAssistantSettings(conv.jobId) : Promise.resolve(undefined),
    db.select()
      .from(commsMessage)
      .where(eq(commsMessage.conversationId, conv.id))
      .orderBy(desc(commsMessage.externalCreatedAt), desc(commsMessage.createdAt))
      .limit(HISTORY_LIMIT),
  ])

  const candidateName = candidate
    ? (candidate.displayName || `${candidate.firstName} ${candidate.lastName}`.trim())
    : null

  const dialogue = history
    .filter(m => m.status !== 'suggested' && m.status !== 'discarded' && m.status !== 'generating' && (m.body ?? '').trim())
    .reverse()
    .map(m => `${m.direction === 'in' ? 'Кандидат' : 'Рекрутер'}: ${(m.body ?? '').trim()}`)
    .join('\n')

  const personaName = profile.personaName?.trim() || 'Ассистент рекрутера'
  const personaRole = profile.personaRole?.trim() || 'ИИ-ассистент команды подбора'
  const lang = profile.language === 'en' ? 'английском' : 'русском'
  // Чат 2.0: тон вакансии (если задан) важнее глобального
  const tone = (jobSettings?.toneOverride && TONE_HINTS[jobSettings.toneOverride])
    ? jobSettings.toneOverride
    : profile.tone

  const systemParts = [
    opts.autopilot
      ? `Ты — ${personaName}, ${personaRole}. Ты ОТ ИМЕНИ рекрутера автоматически отвечаешь кандидату в чате по вакансии. Если вопрос требует решения человека или информации, которой нет в контексте, — вежливо ответь, что уточнишь у рекрутера и вернёшься с ответом.`
      : `Ты — ${personaName}, ${personaRole}. Ты готовишь ЧЕРНОВИК ответа рекрутера кандидату в чате по вакансии.`,
    TONE_HINTS[tone] ?? TONE_HINTS.neutral,
    `Пиши на ${lang} языке.`,
    'Требования к ответу: только текст сообщения без пояснений, коротко и по делу (обычно 1-4 предложения), приветствие уместно только если диалог только начался, не выдумывай факты — если информации нет в контексте, вежливо скажи, что уточнишь у команды.',
    // Чат 2.0: цели общения по вакансии — ассистент выясняет их по одной, не анкетой
    jobSettings?.goals?.trim()
      ? `Цели общения по этой вакансии (выясняй по ходу диалога, по одному вопросу за сообщение, не превращай разговор в анкету):\n${jobSettings.goals.trim()}`
      : '',
    profile.rules?.trim() ? `Правила и ограничения (соблюдай строго):\n${profile.rules.trim()}` : '',
    profile.knowledgeBase?.trim() ? `База знаний организации:\n${profile.knowledgeBase.trim()}` : '',
    jobSettings?.extraContext?.trim() ? `Дополнительно об этой вакансии:\n${jobSettings.extraContext.trim()}` : '',
  ].filter(Boolean)

  const contextParts = [
    job ? `Вакансия: ${job.title}${job.location ? ` (${job.location})` : ''}` : '',
    job?.description ? `Описание вакансии: ${stripHtml(job.description).slice(0, JOB_DESCRIPTION_LIMIT)}` : '',
    candidateName ? `Кандидат: ${candidateName}` : '',
    dialogue ? `История диалога (последние сообщения):\n${dialogue}` : 'Диалог пока пуст — подготовь первое сообщение кандидату по вакансии.',
    'Подготовь следующий ответ рекрутера.',
  ].filter(Boolean)

  let system = systemParts.join('\n\n')
  let prompt = contextParts.join('\n\n')
  // Чат 2.0 (скорость): у reasoning-моделей Qwen просим отключить «размышления».
  // Soft switch /no_think действует по ПОСЛЕДНЕМУ вхождению — дублируем в конец
  // user-сообщения. Часть моделей (thinking-only) его игнорирует — на этот случай
  // бюджет токенов выше вмещает размышления, а extractVisibleText их отрезает.
  if (cfg.provider === 'cloud_ru' && /qwen/i.test(cfg.model)) {
    system += '\n/no_think'
    prompt += '\n/no_think'
  }

  const model = createLanguageModel({
    provider: cfg.provider as SupportedProvider,
    model: cfg.model,
    apiKeyEncrypted: cfg.apiKeyEncrypted,
    baseUrl: cfg.baseUrl,
    maxTokens: Math.min(cfg.maxTokens, MAX_OUTPUT_TOKENS),
  })

  const started = Date.now()
  const result = await generateText({
    model,
    system,
    prompt,
    temperature: 0.4,
    // Чат 2.0 (скорость): потолок ответа + таймаут вместо «думает вечно»
    maxOutputTokens: Math.min(cfg.maxTokens, MAX_OUTPUT_TOKENS),
    maxRetries: 1,
    abortSignal: AbortSignal.timeout(GENERATION_TIMEOUT_MS),
  })
  const text = extractVisibleText(result.text)
  if (!text) {
    // Диагностика в лог — почему пусто (обычно finishReason=length у reasoning-моделей)
    logWarn('comms.assistant_empty_text', {
      conversation_id: conv.id,
      model: cfg.model,
      provider: cfg.provider,
      finish_reason: result.finishReason,
      output_tokens: result.usage?.outputTokens ?? null,
      reasoning_len: result.reasoningText?.length ?? 0,
    })
    throw createError({
      statusCode: 502,
      statusMessage: result.finishReason === 'length'
        ? 'Модель потратила весь лимит токенов на размышления — выберите более быструю модель в настройках суфлёра'
        : 'Ассистент вернул пустой черновик',
    })
  }

  const durationMs = Date.now() - started
  logInfo('comms.assistant_generate', {
    conversation_id: conv.id,
    autopilot: opts.autopilot ?? false,
    model: cfg.model,
    provider: cfg.provider,
    duration_ms: durationMs,
    input_tokens: result.usage?.inputTokens ?? null,
    output_tokens: result.usage?.outputTokens ?? null,
  })

  return { text, personaName, model: cfg.model, provider: cfg.provider, durationMs }
}
