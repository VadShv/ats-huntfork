import { and, eq } from 'drizzle-orm'
import { assessmentTopic, bankQuestion } from '../../../database/schema'
import { generateBankQuestionsSchema } from '../../../utils/schemas/bankQuestion'
import { generateBankQuestions } from '../../../utils/ai/generateBankQuestions'
import type { SupportedProvider } from '../../../utils/ai/provider'
import { loadAiConfig } from '../../../utils/ai/loadConfig'
import { normalizeQuestion } from '../../../utils/text/normalizeQuestion'
import { nextEntityCode } from '../../../utils/questions/generateCode'
import { createRateLimiter } from '../../../utils/rateLimit'

const limiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 10,
  message: 'Слишком много запросов на генерацию. Повторите позже',
})

/**
 * POST /api/question-bank/questions/generate
 * AI-генерация черновиков вопросов под тему (source=ai_generated, status=draft).
 * Идемпотентно: дубли по нормализованному тексту отсеиваются. create_draft.
 */
export default defineEventHandler(async (event) => {
  await limiter(event)
  const session = await requirePermission(event, { questionBank: ['create_draft'] })
  const orgId = session.session.activeOrganizationId
  const body = await readValidatedBody(event, generateBankQuestionsSchema.parse)

  const topic = await db.query.assessmentTopic.findFirst({
    where: and(eq(assessmentTopic.id, body.topicId), eq(assessmentTopic.organizationId, orgId)),
  })
  if (!topic) throw createError({ statusCode: 404, statusMessage: 'Тема не найдена' })

  const config = await loadAiConfig(orgId, { purpose: 'analysis', preferId: body.aiConfigId })

  const generated = await generateBankQuestions(
    {
      provider: config.provider as SupportedProvider,
      model: config.model,
      apiKeyEncrypted: config.apiKeyEncrypted,
      baseUrl: config.baseUrl,
      maxTokens: config.maxTokens,
    },
    {
      topic: {
        name: topic.name,
        type: topic.type,
        definition: topic.definition,
        goal: topic.goal,
        positiveIndicators: topic.positiveIndicators,
        negativeIndicators: topic.negativeIndicators,
      },
      count: body.count,
      extraInstruction: body.extraInstruction,
    },
  )

  // Дедуп против существующих вопросов темы.
  const existing = await db.query.bankQuestion.findMany({
    where: and(eq(bankQuestion.organizationId, orgId), eq(bankQuestion.primaryTopicId, body.topicId)),
    columns: { text: true },
  })
  const seen = new Set(existing.map(e => normalizeQuestion(e.text)))

  const toInsert = generated.filter((g) => {
    const n = normalizeQuestion(g.text)
    if (seen.has(n)) return false
    seen.add(n)
    return true
  })

  if (toInsert.length === 0) return { created: [], skipped: generated.length }

  const created = await db.transaction(async (tx) => {
    const rows = []
    for (const g of toInsert) {
      const code = await nextEntityCode(tx, 'bank_question', orgId)
      const [row] = await tx.insert(bankQuestion).values({
        organizationId: orgId,
        code,
        primaryTopicId: body.topicId,
        type: g.type,
        text: g.text,
        goal: g.goal || null,
        assesses: g.assesses || null,
        expectedSignal: g.expectedSignal || null,
        status: 'draft',
        source: 'ai_generated',
        ownerId: session.user.id,
        createdById: session.user.id,
      }).returning()
      rows.push(row)
    }
    return rows
  })

  return { created, skipped: generated.length - created.length }
})
