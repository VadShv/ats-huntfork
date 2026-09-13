import { eq, and } from 'drizzle-orm'
import { requireJobInScope } from '../../../../utils/access/scope'
import { job, jobInterviewQuestion } from '../../../../database/schema'
import { jobIdParamSchema, createInterviewQuestionSchema } from '../../../../utils/schemas/interviewQuestion'

/**
 * POST /api/jobs/:id/interview-questions
 * Add one interview question manually (source = manual).
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { job: ['update'] })
  const orgId = session.session.activeOrganizationId

  const { id: jobId } = await getValidatedRouterParams(event, jobIdParamSchema.parse)
  await requireJobInScope(event, jobId as string)
  const body = await readValidatedBody(event, createInterviewQuestionSchema.parse)

  const existingJob = await db.query.job.findFirst({
    where: and(eq(job.id, jobId), eq(job.organizationId, orgId)),
    columns: { id: true },
  })
  if (!existingJob) {
    throw createError({ statusCode: 404, statusMessage: 'Вакансия не найдена' })
  }

  const [created] = await db.insert(jobInterviewQuestion).values({
    organizationId: orgId,
    jobId,
    text: body.text,
    category: body.category,
    rationale: body.rationale ?? null,
    goodAnswer: body.goodAnswer ?? null,
    source: 'manual',
    displayOrder: body.displayOrder,
    createdById: session.user.id,
  }).returning()

  setResponseStatus(event, 201)
  return created
})
