import { z } from 'zod'
import { eq, and, ne } from 'drizzle-orm'
import { pipeline, pipelineStage } from '../../../../database/schema'
import { validatePipelineStages } from '../../../../utils/pipeline-validation'

const paramsSchema = z.object({
  id: z.string().min(1),
  stageId: z.string().min(1),
})

const updateStageSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  displayOrder: z.number().int().min(0).optional(),
  isArchived: z.boolean().optional(),
})

export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { pipeline: ['update'] })
  const orgId = session.session.activeOrganizationId

  const { id: pipelineId, stageId } = await getValidatedRouterParams(event, paramsSchema.parse)
  const body = await readValidatedBody(event, updateStageSchema.parse)

  // Verify pipeline exists and belongs to org
  const parentPipeline = await db.query.pipeline.findFirst({
    where: and(eq(pipeline.id, pipelineId), eq(pipeline.organizationId, orgId)),
    columns: { id: true, isSystem: true },
  })

  if (!parentPipeline) {
    throw createError({ statusCode: 404, statusMessage: 'Pipeline not found' })
  }

  if (parentPipeline.isSystem) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Системный пресет нельзя редактировать. Клонируйте его и редактируйте копию',
    })
  }

  // Verify stage exists
  const existingStage = await db.query.pipelineStage.findFirst({
    where: and(
      eq(pipelineStage.id, stageId),
      eq(pipelineStage.pipelineId, pipelineId),
      eq(pipelineStage.organizationId, orgId),
    ),
    columns: {
      id: true,
      name: true,
      type: true,
      isTerminal: true,
      isArchived: true,
      displayOrder: true,
    },
  })

  if (!existingStage) {
    throw createError({ statusCode: 404, statusMessage: 'Stage not found' })
  }

  // If archiving, validate the remaining active stages still satisfy rules
  if (body.isArchived === true && !existingStage.isArchived) {
    const allStages = await db.query.pipelineStage.findMany({
      where: and(
        eq(pipelineStage.pipelineId, pipelineId),
        eq(pipelineStage.organizationId, orgId),
      ),
      columns: { id: true, name: true, type: true, isTerminal: true, isArchived: true },
    })

    // Simulate archiving this stage
    const afterArchive = allStages.map((s) =>
      s.id === stageId ? { ...s, isArchived: true } : s,
    )

    validatePipelineStages(afterArchive)
  }

  const result = await db.transaction(async (tx) => {
    // Handle displayOrder reindexing
    if (body.displayOrder !== undefined && body.displayOrder !== existingStage.displayOrder) {
      const newOrder = body.displayOrder
      const oldOrder = existingStage.displayOrder

      const allOtherStages = await tx.query.pipelineStage.findMany({
        where: and(
          eq(pipelineStage.pipelineId, pipelineId),
          eq(pipelineStage.organizationId, orgId),
          ne(pipelineStage.id, stageId),
        ),
        columns: { id: true, displayOrder: true },
        orderBy: (s, { asc }) => [asc(s.displayOrder)],
      })

      // Shift other stages to keep order monotonic
      for (const s of allOtherStages) {
        if (newOrder > oldOrder) {
          // Moving down: shift stages between old+1..new DOWN by 1
          if (s.displayOrder > oldOrder && s.displayOrder <= newOrder) {
            await tx.update(pipelineStage)
              .set({ displayOrder: s.displayOrder - 1, updatedAt: new Date() })
              .where(eq(pipelineStage.id, s.id))
          }
        } else {
          // Moving up: shift stages between new..old-1 UP by 1
          if (s.displayOrder >= newOrder && s.displayOrder < oldOrder) {
            await tx.update(pipelineStage)
              .set({ displayOrder: s.displayOrder + 1, updatedAt: new Date() })
              .where(eq(pipelineStage.id, s.id))
          }
        }
      }
    }

    // Update the target stage
    const updatePayload: Record<string, unknown> = { updatedAt: new Date() }
    if (body.name !== undefined) updatePayload.name = body.name
    if (body.displayOrder !== undefined) updatePayload.displayOrder = body.displayOrder
    if (body.isArchived !== undefined) updatePayload.isArchived = body.isArchived

    const [updated] = await tx.update(pipelineStage)
      .set(updatePayload)
      .where(and(
        eq(pipelineStage.id, stageId),
        eq(pipelineStage.pipelineId, pipelineId),
        eq(pipelineStage.organizationId, orgId),
      ))
      .returning({
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

    if (!updated) {
      throw createError({ statusCode: 404, statusMessage: 'Stage not found' })
    }

    return updated
  })

  return result
})
