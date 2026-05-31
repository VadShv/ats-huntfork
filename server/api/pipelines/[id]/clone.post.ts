import { z } from 'zod'
import { eq, and } from 'drizzle-orm'
import { pipeline, pipelineStage } from '../../../database/schema'

const idParamSchema = z.object({ id: z.string().min(1) })

const cloneBodySchema = z.object({
  name: z.string().min(1).max(100).optional(),
})

export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { pipeline: ['create'] })
  const orgId = session.session.activeOrganizationId

  const { id } = await getValidatedRouterParams(event, idParamSchema.parse)
  const body = await readValidatedBody(event, cloneBodySchema.parse)

  // Load source pipeline with non-archived stages
  const source = await db.query.pipeline.findFirst({
    where: and(eq(pipeline.id, id), eq(pipeline.organizationId, orgId)),
    columns: {
      id: true,
      name: true,
      description: true,
    },
    with: {
      stages: {
        where: (s, { eq: eqFn }) => eqFn(s.isArchived, false),
        columns: {
          name: true,
          description: true,
          type: true,
          color: true,
          displayOrder: true,
          isTerminal: true,
        },
        orderBy: (s, { asc }) => [asc(s.displayOrder)],
      },
    },
  })

  if (!source) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }

  const newName = body.name ?? `${source.name} (копия)`
  const newPipelineId = crypto.randomUUID()

  const result = await db.transaction(async (tx) => {
    const [created] = await tx.insert(pipeline).values({
      id: newPipelineId,
      organizationId: orgId,
      name: newName,
      description: source.description,
      isSystem: false,
      isDefault: false,
      isArchived: false,
    }).returning({
      id: pipeline.id,
      name: pipeline.name,
      description: pipeline.description,
      isSystem: pipeline.isSystem,
      isDefault: pipeline.isDefault,
      isArchived: pipeline.isArchived,
      createdAt: pipeline.createdAt,
      updatedAt: pipeline.updatedAt,
    })

    if (!created) {
      throw createError({ statusCode: 500, statusMessage: 'Failed to clone pipeline' })
    }

    const stageValues = source.stages.map((stage, index: number) => ({
      id: crypto.randomUUID(),
      organizationId: orgId,
      pipelineId: newPipelineId,
      name: stage.name,
      description: stage.description,
      type: stage.type,
      color: stage.color,
      displayOrder: index,
      isTerminal: stage.isTerminal,
      isArchived: false,
    }))

    const insertedStages = await tx.insert(pipelineStage).values(stageValues).returning({
      id: pipelineStage.id,
      name: pipelineStage.name,
      description: pipelineStage.description,
      type: pipelineStage.type,
      color: pipelineStage.color,
      displayOrder: pipelineStage.displayOrder,
      isTerminal: pipelineStage.isTerminal,
      isArchived: pipelineStage.isArchived,
      createdAt: pipelineStage.createdAt,
      updatedAt: pipelineStage.updatedAt,
    })

    return { ...created, stages: insertedStages }
  })

  setResponseStatus(event, 201)
  return result
})
