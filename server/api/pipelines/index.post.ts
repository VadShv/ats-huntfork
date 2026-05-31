import { z } from 'zod'
import { eq, and, ilike } from 'drizzle-orm'
import { pipeline, pipelineStage } from '../../database/schema'
import { colorForStageType } from '../../utils/pipeline-colors'
import type { PipelineStageType } from '../../utils/pipeline-colors'
import { validatePipelineStages } from '../../utils/pipeline-validation'

const stageInputSchema = z.object({
  name: z.string().min(1).max(50),
  description: z.string().max(500).optional(),
  type: z.enum(['applied', 'screening', 'interview', 'offer', 'hired', 'rejected', 'custom']),
  isTerminal: z.boolean(),
})

const createPipelineSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  stages: z.array(stageInputSchema).min(2).max(20),
})

export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { pipeline: ['create'] })
  const orgId = session.session.activeOrganizationId

  const body = await readValidatedBody(event, createPipelineSchema.parse)

  // Validate stage rules
  validatePipelineStages(body.stages)

  // Check name uniqueness (case-insensitive) within org
  const existing = await db.query.pipeline.findFirst({
    where: and(
      eq(pipeline.organizationId, orgId),
      ilike(pipeline.name, body.name),
    ),
    columns: { id: true },
  })

  if (existing) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Воронка с таким названием уже существует',
    })
  }

  const pipelineId = crypto.randomUUID()

  const result = await db.transaction(async (tx) => {
    const [created] = await tx.insert(pipeline).values({
      id: pipelineId,
      organizationId: orgId,
      name: body.name,
      description: body.description,
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

    const stageValues = body.stages.map((stage, index: number) => ({
      id: crypto.randomUUID(),
      organizationId: orgId,
      pipelineId,
      name: stage.name,
      description: stage.description,
      type: stage.type,
      isTerminal: stage.isTerminal,
      color: colorForStageType(stage.type as PipelineStageType),
      displayOrder: index,
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
