/**
 * AI-арбитр для подозрительных fuzzy-пар дублей (Sprint 5.2, P5.2).
 *
 * Использует активный AI-конфиг организации (purpose='analysis') для оценки,
 * являются ли два кандидата одним и тем же человеком.
 *
 * Промпт строится на основе всех известных полей кандидатов: имя/фамилия,
 * город, дата рождения, контакты, последний работодатель/должность,
 * образование. Модель возвращает структурированный ответ:
 *   verdict: 'same' | 'different' | 'unsure'
 *   confidence: 0..100
 *   reasoning: краткое объяснение (≤ 500 симв.)
 *
 * Результат сохраняется в candidate_duplicate_candidate.ai_*.
 *
 * Производительность: один вызов LLM на пару. Для массового арбитража
 * используется отдельный endpoint, который вызывает эту функцию в цикле
 * с ограничением concurrency.
 */
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { candidate, candidateDuplicateCandidate } from '../../database/schema'
import { loadAiConfig } from '../ai/loadConfig'
import { generateStructuredOutput } from '../ai/provider'

// ── Схема ответа модели ─────────────────────────────────────────────
const arbiterResponseSchema = z.object({
  verdict: z.enum(['same', 'different', 'unsure']).describe(
    'same — один и тот же человек; different — разные люди; unsure — недостаточно данных или признаки противоречивы.',
  ),
  confidence: z.number().int().min(0).max(100).describe(
    'Уверенность модели в вердикте от 0 до 100.',
  ),
  reasoning: z.string().min(10).max(500).describe(
    'Краткое объяснение вердикта на русском. Опирайся на факты из карточек, не выдумывай.',
  ),
})

export type ArbiterVerdict = z.infer<typeof arbiterResponseSchema>

export interface ArbitrateResult {
  pairId: string
  verdict: 'same' | 'different' | 'unsure'
  confidence: number
  reasoning: string
  usage: { promptTokens: number, completionTokens: number }
}

/**
 * Извлекает ключевые факты из hh-резюме для промпта.
 */
function extractResumeHints(raw: Record<string, unknown> | null | undefined): {
  lastPosition?: string
  lastEmployer?: string
  lastEducation?: string
  totalExperienceMonths?: number
} {
  if (!raw) return {}
  const out: ReturnType<typeof extractResumeHints> = {}
  const exp = (raw as any).experience
  if (Array.isArray(exp) && exp.length > 0) {
    const last = exp[0]
    if (last?.position) out.lastPosition = String(last.position).slice(0, 120)
    if (last?.company) out.lastEmployer = String(last.company).slice(0, 120)
  }
  const edu = (raw as any).education?.primary
  if (Array.isArray(edu) && edu.length > 0) {
    const e = edu[0]
    const parts = [e?.name, e?.organization].filter(Boolean).join(' — ')
    if (parts) out.lastEducation = parts.slice(0, 160)
  }
  const total = (raw as any).total_experience?.months
  if (typeof total === 'number') out.totalExperienceMonths = total
  return out
}

/**
 * Формирует компактное текстовое описание кандидата для промпта.
 */
function formatCandidateForPrompt(c: Record<string, unknown>, label: string): string {
  const lines: string[] = [`=== Кандидат ${label} ===`]
  const hints = extractResumeHints(c.hhResumeRaw as Record<string, unknown> | null | undefined)
  const fields: Array<[string, string]> = [
    ['Фамилия', (c.lastName as string) ?? ''],
    ['Имя', (c.firstName as string) ?? ''],
    ['Дата рождения', (c.dateOfBirth as string) ?? ''],
    ['Город', (c.city as string) ?? ''],
    ['Email', (c.email as string) ?? ''],
    ['Телефон', (c.phone as string) ?? ''],
    ['LinkedIn', (c.linkedin as string) ?? ''],
    ['Telegram', (c.telegram as string) ?? ''],
    ['GitHub', (c.github as string) ?? ''],
    ['Последняя должность', hints.lastPosition ?? ''],
    ['Последний работодатель', hints.lastEmployer ?? ''],
    ['Образование', hints.lastEducation ?? ''],
    ['Общий опыт (мес.)', hints.totalExperienceMonths ? String(hints.totalExperienceMonths) : ''],
  ]
  for (const [k, v] of fields) {
    if (v && String(v).trim().length > 0) lines.push(`${k}: ${v}`)
  }
  if (c.aiSummary && String(c.aiSummary).trim().length > 0) {
    const summary = String(c.aiSummary).slice(0, 600)
    lines.push(`Краткое описание: ${summary}`)
  }
  return lines.join('\n')
}

/**
 * Запустить AI-арбитра для конкретной пары.
 * Не делает ничего, если пара уже проверена (aiVerdict != null) и force=false.
 *
 * @throws 404 если пара не найдена в данной организации
 * @throws 422 если у организации нет AI-конфига
 */
export async function arbitrateDuplicatePair(params: {
  orgId: string
  pairId: string
  force?: boolean
}): Promise<ArbitrateResult> {
  const { orgId, pairId, force = false } = params

  // Грузим пару + двух кандидатов одним запросом
  const pair = await db.query.candidateDuplicateCandidate.findFirst({
    where: eq(candidateDuplicateCandidate.id, pairId),
    with: {
      candidateA: true,
      candidateB: true,
    },
  })

  if (!pair) {
    throw createError({ statusCode: 404, statusMessage: 'Пара не найдена' })
  }

  // Проверяем что оба кандидата принадлежат данной организации
  // (cross-org пары не арбитрируем — это политика безопасности)
  if (pair.candidateA.organizationId !== orgId && pair.candidateB.organizationId !== orgId) {
    throw createError({ statusCode: 403, statusMessage: 'Пара не относится к вашей организации' })
  }

  if (pair.aiVerdict && !force) {
    return {
      pairId: pair.id,
      verdict: pair.aiVerdict as 'same' | 'different' | 'unsure',
      confidence: pair.aiConfidence ?? 0,
      reasoning: pair.aiReasoning ?? '',
      usage: { promptTokens: 0, completionTokens: 0 },
    }
  }

  // Грузим AI-конфиг (purpose='analysis' — тот же что для AI-summary/scoring)
  const config = await loadAiConfig(orgId, { purpose: 'analysis', preferId: null })

  const promptText = [
    formatCandidateForPrompt(pair.candidateA, 'A'),
    formatCandidateForPrompt(pair.candidateB, 'B'),
    '',
    `Fuzzy-скор системы: ${pair.score}/100`,
    `Сигналы: ${JSON.stringify(pair.signals)}`,
  ].join('\n\n')

  const result = await generateStructuredOutput(
    {
      provider: config.provider as 'openai' | 'anthropic' | 'google' | 'openai_compatible' | 'yandex',
      model: config.model,
      apiKeyEncrypted: config.apiKeyEncrypted,
      baseUrl: config.baseUrl,
      maxTokens: Math.min(config.maxTokens, 1024),
    },
    {
      system:
        'Ты опытный HR-аналитик. Тебе даны две карточки кандидатов из ATS-системы и fuzzy-скор '
        + 'их сходства. Твоя задача — решить, один это и тот же человек или нет.\n\n'
        + 'Правила:\n'
        + '• same — если совпадает ФИО + ещё хотя бы один уникальный сигнал '
        + '(дата рожд., email, телефон, LinkedIn, Telegram, GitHub, либо последний работодатель + должность).\n'
        + '• different — если ФИО совпадает, но есть явно противоречащие сигналы '
        + '(разные даты рожд., разные города при коротком стаже, разные emails/телефоны с тем же доменом и т.п.).\n'
        + '• unsure — если данных мало и нельзя уверенно решить (только ФИО, только город).\n\n'
        + 'Не выдумывай факты. Используй только то, что явно указано в карточках. '
        + 'reasoning должен быть конкретным: укажи сигналы, на которые ты опирался.',
      prompt: promptText,
      schema: arbiterResponseSchema,
      schemaName: 'DuplicateArbiterVerdict',
      schemaDescription: 'Вердикт AI-арбитра по подозрительной паре кандидатов.',
    },
  )

  const verdict = result.object
  const now = new Date()

  await db.update(candidateDuplicateCandidate)
    .set({
      aiVerdict: verdict.verdict,
      aiConfidence: verdict.confidence,
      aiReasoning: verdict.reasoning,
      aiCheckedAt: now,
      aiUsageInputTokens: result.usage.promptTokens,
      aiUsageOutputTokens: result.usage.completionTokens,
      updatedAt: now,
    })
    .where(eq(candidateDuplicateCandidate.id, pairId))

  return {
    pairId: pair.id,
    verdict: verdict.verdict,
    confidence: verdict.confidence,
    reasoning: verdict.reasoning,
    usage: result.usage,
  }
}
