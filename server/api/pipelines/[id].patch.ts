import { z } from 'zod'
import { eq, and, ilike, ne, inArray } from 'drizzle-orm'
import { pipeline, pipelineStage } from '../../database/schema'
import { colorForStageType } from '../../utils/pipeline-colors'
import {
  validatePipelineStages,
  ALL_STAGE_TYPES,
  bucketForType,
  isTerminalTypeDefault,
} from '../../utils/pipeline-validation'
import type { PipelineStageType } from '../../utils/pipeline-validation'

const idParamSchema = z.object({ id: z.string().min(1) })

/**
 * PATCH /api/pipelines/[id]
 *
 * Для СИСТЕМНЫХ воронок (isSystem=true) разрешено только:
 *   - name, description (метаданные)
 *   - isDefault (сделать дефолтной)
 * Массовое обновление stages для системных воронок ЗАПРЕЩЕНО.
 * Управление этапами системной воронки — только через per-stage endpoint'ы
 * (PATCH/DELETE/POST /api/pipelines/[id]/stages/...).
 */
const stageInputSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(50),
  description: z.string().max(500).optional().nullable(),
  type: z.enum(ALL_STAGE_TYPES),
  bucket: z.enum(['working', 'rejected']).optional(),
  isTerminal: z.boolean(),
  isArchived: z.boolean().optional().default(false),
  isHidden: z.boolean().optional().default(false),
  parentStageId: z.string().uuid().nullable().optional(),
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

  const existing = await db.query.pipeline.findFirst({
    where: and(eq(pipeline.id, id), eq(pipeline.organizationId, orgId)),
    columns: { id: true, isSystem: true, isDefault: true, name: true },
  })

  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Воронка не найдена' })
  }

  // ── Системные воронки: массовое обновление stages запрещено ─────
  if (existing.isSystem && body.stages) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Массовое обновление этапов системной воронки запрещено. Используйте эндпоинты для отдельных этапов: POST /stages, PATCH /stages/[id], DELETE /stages/[id]',
    })
  }

  // Name uniqueness
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

  if (body.stages) {
    validatePipelineStages(body.stages as never)
  }

  const result = await db.transaction(async (tx) => {
    if (body.isDefault === true) {
      await tx.update(pipeline)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(and(
          eq(pipeline.organizationId, orgId),
          ne(pipeline.id, id),
          eq(pipeline.isDefault, true),
        ))
    }

    const pipelineUpdates: Record<string, unknown> = { updatedAt: new Date() }
    if (body.name !== undefined) pipelineUpdates.name = body.name
    if (body.description !== undefined) pipelineUpdates.description = body.description
    if (body.isDefault !== undefined) pipelineUpdates.isDefault = body.isDefault

    const [updatedPipeline] = await tx.update(pipeline)
      .set(pipelineUpdates)
      .where(and(eq(pipeline.id, id), eq(pipeline.organizationId, orgId)))
      .returning()

    if (!updatedPipeline) {
      throw createError({ statusCode: 404, statusMessage: 'Воронка не найдена' })
    }

    let updatedStages: unknown[] = []

    if (body.stages) {
      const stagesPayload = body.stages
      const requestedIds = stagesPayload.filter((s) => s.id).map((s) => s.id as string)

      const existingDbStages = await tx.query.pipelineStage.findMany({
        where: and(
          eq(pipelineStage.pipelineId, id),
          eq(pipelineStage.organizationId, orgId),
          eq(pipelineStage.isArchived, false),
        ),
        columns: { id: true, isSystemStage: true },
      })

      // Archive stages not in the request (только пользовательские — системные не архивируем)
      const toArchive = existingDbStages
        .filter((s) => !requestedIds.includes(s.id) && !s.isSystemStage)
        .map((s) => s.id)

      if (toArchive.length > 0) {
        await tx.update(pipelineStage)
          .set({ isArchived: true, updatedAt: new Date() })
          .where(and(
            eq(pipelineStage.pipelineId, id),
            eq(pipelineStage.organizationId, orgId),
            inArray(pipelineStage.id, toArchive),
          ))
      }

      for (let i = 0; i < stagesPayload.length; i++) {
        const stageInput = stagesPayload[i]!
        const color = colorForStageType(stageInput.type as PipelineStageType)
        const displayOrder = i
        const typeBucket = bucketForType(stageInput.type as PipelineStageType)
        const bucket = stageInput.bucket ?? (typeBucket === 'custom' ? 'working' : typeBucket)

        if (stageInput.id) {
          await tx.update(pipelineStage)
            .set({
              name: stageInput.name,
              description: stageInput.description ?? null,
              type: stageInput.type,
              bucket,
              isTerminal: stageInput.isTerminal,
              isArchived: stageInput.isArchived ?? false,
              isHidden: stageInput.isHidden ?? false,
              parentStageId: stageInput.parentStageId ?? null,
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
          await tx.insert(pipelineStage).values({
            id: crypto.randomUUID(),
            organizationId: orgId,
            pipelineId: id,
            name: stageInput.name,
            description: stageInput.description ?? null,
            type: stageInput.type,
            bucket,
            isTerminal: stageInput.isTerminal ?? isTerminalTypeDefault(stageInput.type as PipelineStageType),
            isArchived: stageInput.isArchived ?? false,
            isHidden: stageInput.isHidden ?? false,
            isSystemStage: false,
            parentStageId: stageInput.parentStageId ?? null,
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
        orderBy: (s, { asc }) => [asc(s.displayOrder)],
      })
    } else {
      updatedStages = await tx.query.pipelineStage.findMany({
        where: and(
          eq(pipelineStage.pipelineId, id),
          eq(pipelineStage.organizationId, orgId),
        ),
        orderBy: (s, { asc }) => [asc(s.displayOrder)],
      })
    }

    return { ...updatedPipeline, stages: updatedStages }
  })

  return result
})
