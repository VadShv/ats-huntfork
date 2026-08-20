/**
 * POST /api/extension/search-map
 *
 * П6 Sidekick: генерация карты поиска по вакансии — компании-доноры,
 * гипотезы каналов и готовые поисковые запросы. Через analysis-провайдер
 * организации (вместо локального мока в панели).
 *
 * Body: { jobId } либо { title, description? } (свободный режим без вакансии)
 * Ответ: { ok, map: { profileSummary, donors[], hypotheses[], queries[], antiKeywords[] }, meta }
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
  jobId: z.string().max(64).optional(),
  title: z.string().max(300).optional(),
  description: z.string().max(20_000).optional(),
}).refine(v => v.jobId || v.title, {
  message: 'Нужен jobId или title',
})

const mapSchema = z.object({
  profileSummary: z.string().describe('Короткий портрет искомого специалиста, 2-3 предложения'),
  donors: z.array(z.object({
    company: z.string().describe('Компания-донор или тип компаний'),
    why: z.string().describe('Почему там водятся нужные специалисты'),
  })).min(3).max(10),
  hypotheses: z.array(z.object({
    title: z.string().describe('Название гипотезы поиска'),
    description: z.string().describe('Кого и где искать по этой гипотезе'),
    channels: z.array(z.string()).max(4).describe('Каналы: hh.ru, LinkedIn, Telegram-чаты, GitHub, конференции…'),
  })).min(2).max(6),
  queries: z.array(z.object({
    platform: z.string().describe('Платформа: hh.ru, LinkedIn, GitHub, Google X-Ray…'),
    query: z.string().describe('Готовая строка запроса с операторами'),
    note: z.string().nullish().describe('Что даст этот запрос / когда применять'),
  })).min(3).max(12),
  antiKeywords: z.array(z.string()).max(10).describe('Минус-слова и признаки нерелевантных профилей'),
})

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ').trim()
}

export default defineEventHandler(async (event) => {
  await limiter(event)
  const session = await requirePermission(event, { candidate: ['read'] })
  const orgId = session.session.activeOrganizationId
  const body = await readValidatedBody(event, bodySchema.parse)

  let title = body.title ?? ''
  let description = body.description ?? ''
  if (body.jobId) {
    const rows = await db
      .select({ title: job.title, description: job.description })
      .from(job)
      .where(and(eq(job.id, body.jobId), eq(job.organizationId, orgId)))
      .limit(1)
    const j = rows[0]
    if (!j) {
      throw createError({ statusCode: 404, statusMessage: 'Вакансия не найдена' })
    }
    title = j.title
    description = stripHtml(j.description ?? '')
  }

  const config = await loadAiConfig(orgId, { purpose: 'analysis', preferId: null })
  const providerConfig = {
    provider: config.provider as SupportedProvider,
    model: config.model,
    apiKeyEncrypted: config.apiKeyEncrypted,
    baseUrl: config.baseUrl,
    maxTokens: config.maxTokens,
  }

  const system
    = 'Ты — сорсер-стратег в ATS Huntfork. По вакансии построй карту поиска кандидатов: '
      + 'портрет специалиста, компании-доноры (включая российский рынок), гипотезы каналов '
      + 'и готовые поисковые запросы с операторами (hh.ru, LinkedIn, GitHub, X-Ray). '
      + 'Пиши на русском, конкретно и практично: запросы должны быть готовы к копированию. '
      + 'Не выдумывай несуществующие компании — используй известные на рынке.'

  const prompt = `<вакансия>\nНазвание: ${title}\n${description.slice(0, 8000)}\n</вакансия>\n\nПострой карту поиска.`

  const { object: map, usage } = await generateStructuredOutput(providerConfig, {
    system,
    prompt,
    schema: mapSchema,
    schemaName: 'search_map',
    schemaDescription: 'Карта поиска кандидатов по вакансии',
  })

  logApiRequest(event, session, 'extension.searchMap', {
    jobId: body.jobId ?? null,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
  })

  return {
    ok: true,
    map,
    meta: { provider: config.provider, model: config.model, generatedAt: new Date().toISOString() },
  }
})
