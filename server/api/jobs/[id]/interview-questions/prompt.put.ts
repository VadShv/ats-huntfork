import { eq, and } from 'drizzle-orm'
import { requireJobInScope } from '../../../../utils/access/scope'
import { job, jobQuestionPrompt } from '../../../../database/schema'
import { jobIdParamSchema, savePromptSchema } from '../../../../utils/schemas/interviewQuestion'

/**
 * PUT /api/jobs/:id/interview-questions/prompt
 * Upsert the saved generation prompt.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { job: ['update'] })
  const orgId = session.session.activeOrganizationId

  const { id: jobId } = await getValidatedRouterParams(event, jobIdParamSchema.parse)
  await requireJobInScope(event, jobId as string)
  const body = await readValidatedBody(event, savePromptSchema.parse)

  const existingJob = await db.query.job.findFirst({
    where: and(eq(job.id, jobId), eq(job.organizationId, orgId)),
    columns: { id: true },
  })
  if (!existingJob) {
    throw createError({ statusCode: 404, statusMessage: 'Вакансия не найдена' })
  }

  const now = new Date()
  const existing = await db.query.jobQuestionPrompt.findFirst({
    where: and(eq(jobQuestionPrompt.jobId, jobId), eq(jobQuestionPrompt.organizationId, orgId)),
    columns: { id: true },
  })

  let saved
  if (existing) {
    ;[saved] = await db.update(jobQuestionPrompt)
      .set({ promptText: body.promptText, updatedAt: now })
      .where(and(eq(jobQuestionPrompt.id, existing.id), eq(jobQuestionPrompt.organizationId, orgId)))
      .returning()
  }
  else {
    ;[saved] = await db.insert(jobQuestionPrompt)
      .values({ organizationId: orgId, jobId, promptText: body.promptText })
      .returning()
  }

  return saved
})
