import { z } from 'zod'
import { eq, and, count, asc, desc } from 'drizzle-orm'
import { pipeline, pipelineStage, job } from '../../database/schema'

const listQuerySchema = z.object({
  includeArchived: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v: string) => v === 'true'),
})

export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { pipeline: ['read'] })
  const orgId = session.session.activeOrganizationId

  const { includeArchived } = await getValidatedQuery(event, listQuerySchema.parse)

  // Fetch all pipelines for this org (filter archived if needed)
  const conditions = [eq(pipeline.organizationId, orgId)]
  if (!includeArchived) {
    conditions.push(eq(pipeline.isArchived, false))
  }

  const pipelines = await db.query.pipeline.findMany({
    where: and(...conditions),
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
    orderBy: [
      desc(pipeline.isDefault),
      desc(pipeline.isSystem),
      asc(pipeline.name),
    ],
  })

  if (pipelines.length === 0) {
    return []
  }

  // stagesCount — non-archived stages per pipeline
  const stageCounts = await db
    .select({
      pipelineId: pipelineStage.pipelineId,
      count: count().as('count'),
    })
    .from(pipelineStage)
    .where(and(
      eq(pipelineStage.organizationId, orgId),
      eq(pipelineStage.isArchived, false),
    ))
    .groupBy(pipelineStage.pipelineId)

  const stageCountMap = new Map(stageCounts.map((r) => [r.pipelineId, r.count]))

  // jobsCount — jobs referencing each pipeline
  const jobCounts = await db
    .select({
      pipelineId: job.pipelineId,
      count: count().as('count'),
    })
    .from(job)
    .where(eq(job.organizationId, orgId))
    .groupBy(job.pipelineId)

  const jobCountMap = new Map(
    jobCounts
      .filter((r) => r.pipelineId !== null)
      .map((r) => [r.pipelineId as string, r.count]),
  )

  return pipelines.map((p) => ({
    ...p,
    stagesCount: stageCountMap.get(p.id) ?? 0,
    jobsCount: jobCountMap.get(p.id) ?? 0,
  }))
})
