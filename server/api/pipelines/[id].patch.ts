import { z } from 'zod'
import { eq, and, ilike, ne, inArray } from 'drizzle-orm'
import { pipeline, pipelineStage } from '../../database/schema'
import { colorForStageType } from '../../utils/pipeline-colors'
import type { PipelineStageType } from '../../utils/pipeline-colors'
import { validatePipelineStages } from '../../utils/pipeline-validation'

const idParamSchema = z.object({ id: z.string().min(1) })

const stageInputSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(50),
  description: z.string().max(500).optional().nullable(),
  type: z.enum(['applied', 'screening', 'interview', 'offer', 'hired', 'rejected', 'custom']),
  isTerminal: z.boolean(),
  isArchived: z.boolean().optional().default(false),
})

const updatePipelineSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional().nullable(),
  isDefault: z.boolean().optional(),
  stages: z.array(stageInputSchema).optional(),
})

export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { pipeline: ['update'] })
  const orgId = session.session.activeOrganizationId

  const { id } = await getValidatedRouterParams(event, idParamSchema.parse)
  const body = await readValidatedBody(event, updatePipelineSchema.parse)

  // Fetch existing pipeline
  const existing = await db.query.pipeline.findFirst({
    where: and(eq(pipeline.id, id), eq(pipeline.organizationId, orgId)),
    columns: { id: true, isSystem: true, isDefault: true, name: true },
  })

  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }

  if (existing.isSystem) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Системный пресет нельзя редактировать. Клонируйте его и редактируйте копию',
    })
  }

  // Name uniqueness check (if renaming)
  if (body.name && body.name.toLowerCase() !== existing.name.toLowerCase()) {
    const nameConflict = await db.query.pipeline.findFirst({
      where: and(
        eq(pipeline.organizationId, orgId),
        ilike(pipeline.name, body.name),
        ne(pipeline.id, id),
      ),
      columns: { id: true },
    })
    if (nameConflict) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Воронка с таким названием уже существует',
      })
    }
  }

  // Validate stages if provided
  if (body.stages) {
    validatePipelineStages(body.stages)
  }

  const result = await db.transaction(async (tx) => {
    // If setting this as default, clear other pipelines first
    if (body.isDefault === true) {
      await tx.update(pipeline)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(and(
          eq(pipeline.organizationId, orgId),
          ne(pipeline.id, id),
          eq(pipeline.isDefault, true),
        ))
    }

    // Build pipeline update payload
    const pipelineUpdates: Record<string, unknown> = { updatedAt: new Date() }
    if (body.name !== undefined) pipelineUpdates.name = body.name
    if (body.description !== undefined) pipelineUpdates.description = body.description
    if (body.isDefault !== undefined) pipelineUpdates.isDefault = body.isDefault

    const [updatedPipeline] = await tx.update(pipeline)
      .set(pipelineUpdates)
      .where(and(eq(pipeline.id, id), eq(pipeline.organizationId, orgId)))
      .returning({
        id: pipeline.id,
        name: pipeline.name,
        description: pipeline.description,
        isSystem: pipeline.isSystem,
        isDefault: pipeline.isDefault,
        isArchived: pipeline.isArchived,
        createdAt: pipeline.createdAt,
        updatedAt: pipeline.updatedAt,
      })

    if (!updatedPipeline) {
      throw createError({ statusCode: 404, statusMessage: 'Not found' })
    }

    // Handle stages update
    type StageRow = {
      id: string
      name: string
      description: string | null
      type: string
      color: string
      displayOrder: number
      isTerminal: boolean
      isArchived: boolean
      createdAt: Date
      updatedAt: Date
    }

    let updatedStages: StageRow[] = []

    if (body.stages) {
      const stagesPayload = body.stages

      // IDs provided in the request (existing stages being updated)
      const requestedIds = stagesPayload.filter((s) => s.id).map((s) => s.id as string)

      // Archive stages that exist in DB but are NOT in the request
      const existingDbStages = await tx.query.pipelineStage.findMany({
        where: and(
          eq(pipelineStage.pipelineId, id),
          eq(pipelineStage.organizationId, orgId),
          eq(pipelineStage.isArchived, false),
        ),
        columns: { id: true },
      })

      const dbActiveIds = existingDbStages.map((s) => s.id)
      const toArchive = dbActiveIds.filter((dbId) => !requestedIds.includes(dbId))

      if (toArchive.length > 0) {
        await tx.update(pipelineStage)
          .set({ isArchived: true, updatedAt: new Date() })
          .where(and(
            eq(pipelineStage.pipelineId, id),
            eq(pipelineStage.organizationId, orgId),
            inArray(pipelineStage.id, toArchive),
          ))
      }

      // Upsert stages in order
      for (let i = 0; i < stagesPayload.length; i++) {
        const stageInput = stagesPayload[i]!
        const color = colorForStageType(stageInput.type as PipelineStageType)
        const displayOrder = i

        if (stageInput.id) {
          // Update existing
          await tx.update(pipelineStage)
            .set({
              name: stageInput.name,
              description: stageInput.description ?? null,
              type: stageInput.type,
              isTerminal: stageInput.isTerminal,
              isArchived: stageInput.isArchived ?? false,
              color,
              displayOrder,
              updatedAt: new Date(),
            })
            .where(and(
              eq(pipelineStage.id, stageInput.id),
              eq(pipelineStage.pipelineId, id),
              eq(pipelineStage.organizationId, orgId),
            ))
        } else {
          // Insert new
          await tx.insert(pipelineStage).values({
            id: crypto.randomUUID(),
            organizationId: orgId,
            pipelineId: id,
            name: stageInput.name,
            description: stageInput.description ?? null,
            type: stageInput.type,
            isTerminal: stageInput.isTerminal,
            isArchived: stageInput.isArchived ?? false,
            color,
            displayOrder,
          })
        }
      }

      updatedStages = await tx.query.pipelineStage.findMany({
        where: and(
          eq(pipelineStage.pipelineId, id),
          eq(pipelineStage.organizationId, orgId),
        ),
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
      })
    } else {
      updatedStages = await tx.query.pipelineStage.findMany({
        where: and(
          eq(pipelineStage.pipelineId, id),
          eq(pipelineStage.organizationId, orgId),
        ),
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
      })
    }

    return { ...updatedPipeline, stages: updatedStages }
  })

  return result
})
