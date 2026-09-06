import { eq, and } from 'drizzle-orm'
import { job, jobBrief, jobInterviewQuestion, jobQuestionPrompt } from '../../../../database/schema'
import { jobIdParamSchema, generateInterviewQuestionsSchema } from '../../../../utils/schemas/interviewQuestion'
import { generateInterviewQuestions } from '../../../../utils/ai/generateInterviewQuestions'
import type { SupportedProvider } from '../../../../utils/ai/provider'
import { loadAiConfig } from '../../../../utils/ai/loadConfig'
import { createRateLimiter } from '../../../../utils/rateLimit'

const limiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 10,
  message: 'Слишком много запросов на генерацию вопросов. Повторите позже',
})

/** Normalize question text for de-dup comparison. */
function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').replace(/[«»"'.,;:!?()]/g, '').trim()
}

/**
 * POST /api/jobs/:id/interview-questions/generate
 *
 * Generate questions from prompt + job description + brief via the org's analysis
 * config. Idempotent-ish: existing questions are NOT deleted; duplicates are skipped
 * (normalized text match). Persists the prompt for reuse.
 */
export default defineEventHandler(async (event) => {
  await limiter(event)
  const session = await requirePermission(event, { job: ['update'] })
  const orgId = session.session.activeOrganizationId

  const { id: jobId } = await getValidatedRouterParams(event, jobIdParamSchema.parse)
  const body = await readValidatedBody(event, generateInterviewQuestionsSchema.parse)

  const jobRow = await db.query.job.findFirst({
    where: and(eq(job.id, jobId), eq(job.organizationId, orgId)),
    columns: { id: true, title: true, description: true },
  })
  if (!jobRow) {
    throw createError({ statusCode: 404, statusMessage: 'Вакансия не найдена' })
  }

  const brief = await db.query.jobBrief.findFirst({
    where: and(eq(jobBrief.jobId, jobId), eq(jobBrief.organizationId, orgId)),
  })

  const config = await loadAiConfig(orgId, { purpose: 'analysis', preferId: body.aiConfigId })

  const generated = await generateInterviewQuestions(
    {
      provider: config.provider as SupportedProvider,
      model: config.model,
      apiKeyEncrypted: config.apiKeyEncrypted,
      baseUrl: config.baseUrl,
      maxTokens: config.maxTokens,
    },
    {
      jobTitle: jobRow.title,
      jobDescription: jobRow.description ?? '',
      promptText: body.promptText,
      brief: brief
        ? {
            hardMustHave: brief.hardMustHave,
            niceToHave: brief.niceToHave,
            dealBreakers: brief.dealBreakers,
            redFlagsToWatch: brief.redFlagsToWatch,
            responsibilities: brief.responsibilities,
            idealProfile: brief.idealProfile,
            teamContext: brief.teamContext,
            freeform: brief.freeform,
          }
        : null,
      count: body.count,
    },
  )

  // Existing questions → de-dup set + current max order.
  const existing = await db.query.jobInterviewQuestion.findMany({
    where: and(eq(jobInterviewQuestion.jobId, jobId), eq(jobInterviewQuestion.organizationId, orgId)),
    columns: { text: true, displayOrder: true },
  })
  const seen = new Set(existing.map(q => norm(q.text)))
  let order = existing.reduce((m, q) => Math.max(m, q.displayOrder), -1) + 1

  const toInsert = generated
    .filter((q) => {
      const n = norm(q.text)
      if (seen.has(n)) return false
      seen.add(n)
      return true
    })
    .map(q => ({
      organizationId: orgId,
      jobId,
      text: q.text,
      category: q.category,
      rationale: q.rationale || null,
      goodAnswer: q.goodAnswer || null,
      source: 'ai_generated' as const,
      displayOrder: order++,
      createdById: session.user.id,
    }))

  const inserted = toInsert.length
    ? await db.insert(jobInterviewQuestion).values(toInsert).returning()
    : []

  // Persist the prompt for reuse (upsert on jobId).
  const now = new Date()
  const promptRow = await db.query.jobQuestionPrompt.findFirst({
    where: and(eq(jobQuestionPrompt.jobId, jobId), eq(jobQuestionPrompt.organizationId, orgId)),
    columns: { id: true },
  })
  if (promptRow) {
    await db.update(jobQuestionPrompt)
      .set({ promptText: body.promptText, lastGeneratedAt: now, lastProvider: config.provider, lastModel: config.model, updatedAt: now })
      .where(and(eq(jobQuestionPrompt.id, promptRow.id), eq(jobQuestionPrompt.organizationId, orgId)))
  }
  else {
    await db.insert(jobQuestionPrompt).values({
      organizationId: orgId, jobId, promptText: body.promptText,
      lastGeneratedAt: now, lastProvider: config.provider, lastModel: config.model,
    })
  }

  return {
    created: inserted,
    generatedCount: generated.length,
    insertedCount: inserted.length,
    skippedDuplicates: generated.length - inserted.length,
  }
})
