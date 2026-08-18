import { z } from 'zod'
import { eq, and, ne } from 'drizzle-orm'
import { pipeline, pipelineStage } from '../../../../database/schema'
import { validatePipelineStages, ALL_STAGE_TYPES } from '../../../../utils/pipeline-validation'
import { colorForStageType } from '../../../../utils/pipeline-colors'
import type { PipelineStageType } from '../../../../utils/pipeline-validation'

const paramsSchema = z.object({
  id: z.string().min(1),
  stageId: z.string().min(1),
})

/**
 * PATCH /api/pipelines/[id]/stages/[stageId]
 *
 * Для системных этапов (isSystemStage=true) разрешено ТОЛЬКО:
 *   - isHidden (скрыть/показать)
 * Спринт 11.3: displayOrder для системных запрещён — базовые этапы зафиксированы (порядок как на hh.ru).
 * Все остальные поля (name, type, bucket, isTerminal, parentStageId, isArchived)
 * запрещены — вернётся 403.
 *
 * Для пользовательских этапов разрешены все поля.
 */
const updateStageSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  description: z.string().max(500).optional().nullable(),
  type: z.enum(ALL_STAGE_TYPES).optional(),
  bucket: z.enum(['working', 'rejected']).optional(),
  isTerminal: z.boolean().optional(),
  isHidden: z.boolean().optional(),
  isArchived: z.boolean().optional(),
  displayOrder: z.number().int().min(0).optional(),
  parentStageId: z.string().uuid().nullable().optional(),
  /**
   * Спринт 22: org-дефолтный шаблон отказного сообщения.
   * Разрешён в т.ч. для базовых (системных) этапов — это настройка
   * сообщения, а не структурное изменение воронки.
   */
  rejectMessageTemplate: z.string().max(5000).nullable().optional(),
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
    throw createError({ statusCode: 404, statusMessage: 'Воронка не найдена' })
  }

  // Verify stage exists
  const existingStage = await db.query.pipelineStage.findFirst({
    where: and(
      eq(pipelineStage.id, stageId),
      eq(pipelineStage.pipelineId, pipelineId),
      eq(pipelineStage.organizationId, orgId),
    ),
  })

  if (!existingStage) {
    throw createError({ statusCode: 404, statusMessage: 'Этап не найден' })
  }

  // ── Защита системных этапов ────────────────────────────────────────
  // Системные этапы: разрешено только isHidden.
  // Спринт 11.3: displayOrder запрещён — базовые этапы зафиксированы.
  if (existingStage.isSystemStage) {
    const forbiddenFields: string[] = []
    if (body.name !== undefined) forbiddenFields.push('name')
    if (body.type !== undefined) forbiddenFields.push('type')
    if (body.bucket !== undefined) forbiddenFields.push('bucket')
    if (body.isTerminal !== undefined) forbiddenFields.push('isTerminal')
    if (body.parentStageId !== undefined) forbiddenFields.push('parentStageId')
    if (body.isArchived !== undefined) forbiddenFields.push('isArchived')
    if (body.description !== undefined) forbiddenFields.push('description')
    if (body.displayOrder !== undefined) forbiddenFields.push('displayOrder')

    if (forbiddenFields.length > 0) {
      throw createError({
        statusCode: 403,
        statusMessage: `Базовый этап зафиксирован: его нельзя менять или перемещать — только скрыть. Запрещены: ${forbiddenFields.join(', ')}`,
      })
    }
  }

  // ── Валидация bucket подстатуса относительно родителя ────────────
  if (body.parentStageId !== undefined && body.parentStageId !== null) {
    const parent = await db.query.pipelineStage.findFirst({
      where: and(
        eq(pipelineStage.id, body.parentStageId),
        eq(pipelineStage.pipelineId, pipelineId),
        eq(pipelineStage.organizationId, orgId),
      ),
      columns: { id: true, parentStageId: true, bucket: true, name: true },
    })
    if (!parent) {
      throw createError({ statusCode: 400, statusMessage: 'Родительский этап не найден' })
    }
    if (parent.parentStageId) {
      throw createError({
        statusCode: 400,
        statusMessage: `Родительский этап «${parent.name}» сам является подстатусом. Максимум 1 уровень вложенности`,
      })
    }
    if (parent.id === stageId) {
      throw createError({ statusCode: 400, statusMessage: 'Этап не может быть подстатусом сам себя' })
    }
  }

  // ── Если скрываем этап — валидируем что воронка останется корректной ──
  if (body.isHidden === true && !existingStage.isHidden) {
    const allStages = await db.query.pipelineStage.findMany({
      where: and(
        eq(pipelineStage.pipelineId, pipelineId),
        eq(pipelineStage.organizationId, orgId),
      ),
    })
    const afterHide = allStages.map((s) =>
      s.id === stageId ? { ...s, isHidden: true } : s,
    )
    validatePipelineStages(afterHide as never)
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
      })

      for (const s of allOtherStages) {
        if (newOrder > oldOrder) {
          if (s.displayOrder > oldOrder && s.displayOrder <= newOrder) {
            await tx.update(pipelineStage)
              .set({ displayOrder: s.displayOrder - 1, updatedAt: new Date() })
              .where(eq(pipelineStage.id, s.id))
          }
        } else {
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
    if (body.description !== undefined) updatePayload.description = body.description
    if (body.type !== undefined) {
      updatePayload.type = body.type
      updatePayload.color = colorForStageType(body.type as PipelineStageType)
    }
    if (body.bucket !== undefined) updatePayload.bucket = body.bucket
    if (body.isTerminal !== undefined) updatePayload.isTerminal = body.isTerminal
    if (body.isHidden !== undefined) updatePayload.isHidden = body.isHidden
    if (body.isArchived !== undefined) updatePayload.isArchived = body.isArchived
    if (body.displayOrder !== undefined) updatePayload.displayOrder = body.displayOrder
    if (body.parentStageId !== undefined) updatePayload.parentStageId = body.parentStageId
    if (body.rejectMessageTemplate !== undefined) {
      updatePayload.rejectMessageTemplate = body.rejectMessageTemplate?.trim() || null
    }

    const [updated] = await tx.update(pipelineStage)
      .set(updatePayload)
      .where(and(
        eq(pipelineStage.id, stageId),
        eq(pipelineStage.pipelineId, pipelineId),
        eq(pipelineStage.organizationId, orgId),
      ))
      .returning()

    if (!updated) {
      throw createError({ statusCode: 404, statusMessage: 'Этап не найден' })
    }

    return updated
  })

  return result
})
