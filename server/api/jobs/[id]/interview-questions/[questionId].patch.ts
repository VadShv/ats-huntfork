import { eq, and } from 'drizzle-orm'
import { requireJobInScope } from '../../../../utils/access/scope'
import { jobInterviewQuestion } from '../../../../database/schema'
import { questionIdParamSchema, updateInterviewQuestionSchema } from '../../../../utils/schemas/interviewQuestion'

/**
 * PATCH /api/jobs/:id/interview-questions/:questionId
 * Edit a question. Editing text/category/rationale/goodAnswer of an AI question
 * flips its source to 'edited' (archive/reorder toggles do not).
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { job: ['update'] })
  const orgId = session.session.activeOrganizationId

  const { id: jobId, questionId } = await getValidatedRouterParams(event, questionIdParamSchema.parse)
  await requireJobInScope(event, jobId as string)
  const body = await readValidatedBody(event, updateInterviewQuestionSchema.parse)

  const existing = await db.query.jobInterviewQuestion.findFirst({
    where: and(
      eq(jobInterviewQuestion.id, questionId),
      eq(jobInterviewQuestion.jobId, jobId),
      eq(jobInterviewQuestion.organizationId, orgId),
    ),
  })
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Вопрос не найден' })
  }

  const isContentEdit
    = body.text !== undefined || body.category !== undefined
      || body.rationale !== undefined || body.goodAnswer !== undefined
  const nextSource = isContentEdit && existing.source === 'ai_generated' ? 'edited' : existing.source

  const [updated] = await db.update(jobInterviewQuestion)
    .set({
      ...(body.text !== undefined ? { text: body.text } : {}),
      ...(body.category !== undefined ? { category: body.category } : {}),
      ...(body.rationale !== undefined ? { rationale: body.rationale ?? null } : {}),
      ...(body.goodAnswer !== undefined ? { goodAnswer: body.goodAnswer ?? null } : {}),
      ...(body.displayOrder !== undefined ? { displayOrder: body.displayOrder } : {}),
      ...(body.isArchived !== undefined ? { isArchived: body.isArchived } : {}),
      source: nextSource,
      updatedAt: new Date(),
    })
    .where(and(
      eq(jobInterviewQuestion.id, questionId),
      eq(jobInterviewQuestion.organizationId, orgId),
    ))
    .returning()

  return updated
})
