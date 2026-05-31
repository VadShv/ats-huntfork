import { z } from 'zod'
import { eq, and, count, ne, inArray } from 'drizzle-orm'
import { pipeline, pipelineStage, job, application } from '../../database/schema'

const idParamSchema = z.object({ id: z.string().min(1) })

export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { pipeline: ['read'] })
  const orgId = session.session.activeOrganizationId

  const { id } = await getValidatedRouterParams(event, idParamSchema.parse)

  const found = await db.query.pipeline.findFirst({
    where: and(eq(pipeline.id, id), eq(pipeline.organizationId, orgId)),
    columns: {
      id: true,
      name: true,
      description: true,
      isSystem: true,
      isDefault: true,
      isArchived: true,
      createdAt: true,
      updatedAt: true,
    },
    with: {
      stages: {
        columns: {
          id: true,
          name: true,
          description: true,
          type: true,
          color: true,
          displayOrder: true,
          isTerminal: true,
          isArchived: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: (s, { asc }) => [asc(s.displayOrder)],
      },
    },
  })

  if (!found) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }

  // jobsCount — jobs using this pipeline
  const [jobsCountRow] = await db
    .select({ count: count() })
    .from(job)
    .where(and(eq(job.organizationId, orgId), eq(job.pipelineId, id)))

  const jobsCount = jobsCountRow?.count ?? 0

  // activeApplicationsCount — applications on jobs using this pipeline
  // where the OLD status enum is NOT hired/rejected (back-compat)
  const jobIds = await db
    .select({ id: job.id })
    .from(job)
    .where(and(eq(job.organizationId, orgId), eq(job.pipelineId, id)))

  let activeApplicationsCount = 0
  if (jobIds.length > 0) {
    const [activeRow] = await db
      .select({ count: count() })
      .from(application)
      .where(and(
        eq(application.organizationId, orgId),
        inArray(application.jobId, jobIds.map((j) => j.id)),
        ne(application.status, 'hired'),
        ne(application.status, 'rejected'),
      ))
    activeApplicationsCount = activeRow?.count ?? 0
  }

  return {
    ...found,
    jobsCount,
    activeApplicationsCount,
  }
})
