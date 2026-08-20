/**
 * POST /api/extension/verification/run
 *
 * П4 Sidekick: верификация профиля кандидата через analysis-провайдер
 * организации (тот же контур, что chat/summarize; скрининг Qwen не трогаем).
 *
 * Синхронный запуск: анализ занимает 15–60 секунд, отчёт возвращается сразу
 * и в БД не сохраняется (эфемерный, как история чата панели). Сохранение
 * выжимки в ATS — отдельной заметкой через /api/extension/note.
 *
 * Body: { text (текст профиля), title?, sourceUrl?, jobId? }
 * Ответ: { ok, report: { summary, timeline[], contradictions[],
 *                        verifiability[], redFlags[], questions[] }, meta }
 */
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { job } from '../../../database/schema'
import { loadAiConfig } from '../../../utils/ai/loadConfig'
import { generateStructuredOutput, type SupportedProvider } from '../../../utils/ai/provider'
import { createRateLimiter } from '../../../utils/rateLimit'

const limiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 6,
  message: 'Слишком много запусков верификации. Подождите минуту',
})

const bodySchema = z.object({
  text: z.string().min(200, 'Слишком мало текста для анализа').max(80_000),
  title: z.string().max(300).optional(),
  sourceUrl: z.string().url().max(2000).optional(),
  jobId: z.string().max(64).optional(),
})

const reportSchema = z.object({
  summary: z.string().describe('Короткая выжимка: общее впечатление о достоверности профиля, 2-4 предложения'),
  timeline: z.array(z.object({
    period: z.string().describe('Период, например «2021–2023» или «март 2022 — н.в.»'),
    place: z.string().describe('Компания или место'),
    role: z.string().describe('Роль/должность'),
    note: z.string().nullish().describe('Примечание: разрыв, пересечение, неточность дат'),
    gap: z.boolean().nullish().describe('true, если перед этим местом есть необъяснённый разрыв стажа'),
  })).max(20).describe('Хронология карьеры по фактам из текста'),
  contradictions: z.array(z.object({
    claim: z.string().describe('Утверждение из профиля'),
    issue: z.string().describe('В чём противоречие или нестыковка'),
    severity: z.enum(['low', 'medium', 'high']),
  })).max(15),
  verifiability: z.array(z.object({
    claim: z.string().describe('Ключевое проверяемое утверждение'),
    status: z.enum(['verifiable', 'partially', 'unverifiable']),
    how: z.string().nullish().describe('Как проверить: вопрос, документ, публичный источник'),
  })).max(15),
  redFlags: z.array(z.object({
    flag: z.string(),
    severity: z.enum(['low', 'medium', 'high']),
    basis: z.string().describe('На каком факте из текста основан флаг'),
  })).max(10),
  questions: z.array(z.string()).max(12).describe('Верификационные вопросы для интервью'),
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
    = 'Ты — аналитик верификации кандидатов в ATS Huntfork. Работаешь ТОЛЬКО с фактами '
      + 'из предоставленного текста профиля: не выдумывай события, компании и даты. '
      + 'Твоя задача — построить хронологию карьеры, найти противоречия и разрывы, '
      + 'оценить проверяемость ключевых утверждений, отметить красные флаги и '
      + 'сформулировать верификационные вопросы для интервью. Пиши на русском, кратко и по делу. '
      + 'Не делай финального решения о найме. Если данных мало — верни короткие списки, не заполняй их догадками.'

  const prompt = `Источник: ${body.title ?? ''} ${body.sourceUrl ? `(${body.sourceUrl})` : ''}${jobContext}\n\n<профиль>\n${text}\n</профиль>\n\nПроведи верификационный анализ профиля.`

  const { object: report, usage } = await generateStructuredOutput(providerConfig, {
    system,
    prompt,
    schema: reportSchema,
    schemaName: 'verification_report',
    schemaDescription: 'Верификационный отчёт по профилю кандидата',
  })

  logApiRequest(event, session, 'extension.verificationRun', {
    textLength: text.length,
    jobId: body.jobId ?? null,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
  })

  return {
    ok: true,
    report,
    meta: { provider: config.provider, model: config.model, generatedAt: new Date().toISOString() },
  }
})
