import { eq, and } from 'drizzle-orm'
import { job, pipeline } from '../../database/schema'
import { idParamSchema } from '../../utils/schemas/job'
import { getActorContext } from '../../utils/access/actorContext'
import { isJobInScope } from '../../utils/access/scope'

export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { job: ['read'] })
  const orgId = session.session.activeOrganizationId
  const actor = await getActorContext(event)

  const { id } = await getValidatedRouterParams(event, idParamSchema.parse)

  // Scope guard (RBAC v2 — "private jobs"): a job outside the actor's scope
  // returns 404 even by direct ID. Foundation for the shared-candidate model.
  if (actor && !(await isJobInScope(actor, id))) {
    throw createError({ statusCode: 404, statusMessage: 'Вакансия не найдена' })
  }

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
      headcount: true,
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
