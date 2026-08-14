import { eq, and } from 'drizzle-orm'
import { aiConfig, job } from '../../../../database/schema'
import { generateCriteriaSchema } from '../../../../utils/schemas/scoring'
import { generateCriteriaFromDescription, PREMADE_CRITERIA } from '../../../../utils/ai/scoring'
import type { SupportedProvider } from '../../../../utils/ai/provider'
import { createRateLimiter } from '../../../../utils/rateLimit'
import { z } from 'zod'

const paramsSchema = z.object({ id: z.string().min(1) })
const limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 10, message: 'Слишком много запросов на генерацию ИИ-критериев. Повторите позже' })

/**
 * POST /api/jobs/:id/criteria/generate
 * Generate scoring criteria from a pre-made template or by AI analysis of the job description.
 * Does NOT persist — returns generated criteria for the client to review before saving.
 */
export default defineEventHandler(async (event) => {
  await limiter(event)
  const session = await requirePermission(event, { scoring: ['create'] })
  const orgId = session.session.activeOrganizationId
  const { id: jobId } = await getValidatedRouterParams(event, paramsSchema.parse)
  const body = await readValidatedBody(event, generateCriteriaSchema.parse)

  // Verify job belongs to org
  const jobRecord = await db.query.job.findFirst({
    where: and(eq(job.id, jobId), eq(job.organizationId, orgId)),
    columns: { id: true, title: true, description: true },
  })
  if (!jobRecord) {
    throw createError({ statusCode: 404, statusMessage: 'Вакансия не найдена' })
  }

  // If a pre-made template is specified, return it directly
  if (body.template) {
    const template = PREMADE_CRITERIA[body.template]
    if (!template) {
      throw createError({ statusCode: 400, statusMessage: 'Неизвестный шаблон' })
    }
    return { criteria: template, source: 'template' }
  }

  // Otherwise generate from job description using AI
  if (!jobRecord.description) {
    throw createError({
      statusCode: 422,
      statusMessage: 'Для генерации ИИ-критериев требуется описание вакансии. Сначала добавьте описание',
    })
  }

  const config = await db.query.aiConfig.findFirst({
    where: eq(aiConfig.organizationId, orgId),
  })
  if (!config) {
    throw createError({
      statusCode: 422,
      statusMessage: 'Поставщик ИИ не настроен. Сначала настройте поставщика ИИ в настройках',
    })
  }

  const criteria = await generateCriteriaFromDescription(
    {
      provider: config.provider as SupportedProvider,
      model: config.model,
      apiKeyEncrypted: config.apiKeyEncrypted,
      baseUrl: config.baseUrl,
      maxTokens: config.maxTokens,
    },
    jobRecord.title,
    jobRecord.description,
  )

  return { criteria, source: 'ai' }
})
