/**
 * POST /api/extension/interview-card
 *
 * П6 Sidekick: генерация карточки интервью (STAR-вопросы по компетенциям)
 * через analysis-провайдер организации — вместо локального генератора-мока.
 *
 * Body: { text (профиль кандидата), title?, sourceUrl?, jobId?, focus? }
 * Ответ: { ok, card: { role, intro[], blocks[], finalChecks[] }, meta }
 *
 * Сохранение в ATS — заметкой кандидата через существующий /api/extension/note.
 */
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { job } from '../../database/schema'
import { loadAiConfig } from '../../utils/ai/loadConfig'
import { generateStructuredOutput, type SupportedProvider } from '../../utils/ai/provider'
import { createRateLimiter } from '../../utils/rateLimit'

const limiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 6,
  message: 'Слишком много генераций. Подождите минуту',
})

const bodySchema = z.object({
  text: z.string().min(200, 'Слишком мало текста профиля').max(80_000),
  title: z.string().max(300).optional(),
  sourceUrl: z.string().url().max(2000).optional(),
  jobId: z.string().max(64).optional(),
  focus: z.string().max(500).optional(),
})

const cardSchema = z.object({
  role: z.string().describe('Роль, под которую собрана карточка'),
  intro: z.array(z.string()).max(4).describe('Вводные вопросы для разогрева, привязанные к опыту кандидата'),
  blocks: z.array(z.object({
    competency: z.string().describe('Название компетенции'),
    rationale: z.string().describe('Почему эта компетенция важна для данного кандидата/роли'),
    questions: z.array(z.object({
      question: z.string().describe('Вопрос в формате STAR, привязанный к конкретному факту из профиля'),
      listenFor: z.string().describe('Маркеры сильного ответа'),
      redFlag: z.string().nullish().describe('Что в ответе должно насторожить'),
    })).min(1).max(4),
  })).min(2).max(7),
  finalChecks: z.array(z.string()).max(5).describe('Финальные проверки: мотивация, ожидания, ограничения'),
})

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ').trim()
}

export default defineEventHandler(async (event) => {
  await limiter(event)
  const session = await requirePermission(event, { candidate: ['read'] })
  const orgId = session.session.activeOrganizationId
  const body = await readValidatedBody(event, bodySchema.parse)

  let jobContext = ''
  if (body.jobId) {
    const rows = await db
      .select({ title: job.title, description: job.description })
      .from(job)
      .where(and(eq(job.id, body.jobId), eq(job.organizationId, orgId)))
      .limit(1)
    const j = rows[0]
    if (j) {
      jobContext = `\n\n<вакансия>\nНазвание: ${j.title}\n${stripHtml(j.description ?? '').slice(0, 3000)}\n</вакансия>`
    }
  }

  const text = body.text
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .slice(0, 24_000)

  const config = await loadAiConfig(orgId, { purpose: 'analysis', preferId: null })
  const providerConfig = {
    provider: config.provider as SupportedProvider,
    model: config.model,
    apiKeyEncrypted: config.apiKeyEncrypted,
    baseUrl: config.baseUrl,
    maxTokens: config.maxTokens,
  }

  const system
    = 'Ты — методолог структурированных интервью в ATS Huntfork. По тексту профиля кандидата '
      + (jobContext ? 'и вакансии ' : '')
      + 'составь карточку интервью: компетенции, STAR-вопросы, маркеры сильных ответов и красные флаги. '
      + 'Каждый вопрос привязывай к КОНКРЕТНОМУ факту из профиля (проект, компания, технология) — '
      + 'никаких абстрактных вопросов из учебника. Пиши на русском.'
      + (body.focus ? `\n\nОсобый фокус от рекрутёра: ${body.focus}` : '')

  const prompt = `Источник: ${body.title ?? ''} ${body.sourceUrl ? `(${body.sourceUrl})` : ''}${jobContext}\n\n<профиль>\n${text}\n</профиль>\n\nСобери карточку интервью.`

  const t0 = Date.now()
  const { object: card, usage, responseModel } = await generateStructuredOutput(providerConfig, {
    system,
    prompt,
    schema: cardSchema,
    schemaName: 'interview_card',
    schemaDescription: 'Карточка структурированного интервью по компетенциям',
  })
  const totalMs = Date.now() - t0

  logApiRequest(event, session, 'extension.interviewCard', {
    textLength: text.length,
    jobId: body.jobId ?? null,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    // П1: длительность и фактическая модель
    total_ms: totalMs,
    ai_provider: config.provider,
    ai_model: config.model,
    response_model: responseModel,
  })

  return {
    ok: true,
    card,
    meta: { provider: config.provider, model: config.model, totalMs, generatedAt: new Date().toISOString() },
  }
})
