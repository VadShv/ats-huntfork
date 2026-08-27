import { eq, and } from 'drizzle-orm'
import { job, pipeline } from '../../database/schema'
import { idParamSchema } from '../../utils/schemas/job'

export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { job: ['read'] })
  const orgId = session.session.activeOrganizationId

  const { id } = await getValidatedRouterParams(event, idParamSchema.parse)

  const result = await db.query.job.findFirst({
    where: and(eq(job.id, id), eq(job.organizationId, orgId)),
    columns: {
      id: true,
      title: true,
      slug: true,
      description: true,
      location: true,
      type: true,
      status: true,
      salaryMin: true,
      salaryMax: true,
      salaryCurrency: true,
      salaryUnit: true,
      salaryNegotiable: true,
      remoteStatus: true,
      validThrough: true,
      requireResume: true,
      requireCoverLetter: true,
      autoScoreOnApply: true,
      autoRejectEnabled: true,
      autoRejectBelowScore: true,
      autoRejectReasonNote: true,
      autoAdvanceEnabled: true,
      autoAdvanceAboveScore: true,
      autoAdvanceReasonNote: true,
      experienceLevel: true,
      companyId: true,
      departmentId: true,
      pipelineId: true,
      createdAt: true,
      updatedAt: true,
    },
    with: {
      applications: {
        columns: { id: true, candidateId: true, status: true, createdAt: true },
        limit: 100,
      },
      pipeline: {
        columns: { id: true, name: true, isDefault: true, isSystem: true },
      },
    },
  })

  if (!result) {
    throw createError({ statusCode: 404, statusMessage: 'Вакансия не найдена' })
  }

  return {
    ...result,
    pipelineName: result.pipeline?.name ?? null,
  }
})
