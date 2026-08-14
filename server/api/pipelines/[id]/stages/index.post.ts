import { z } from 'zod'
import { eq, and, desc } from 'drizzle-orm'
import { pipeline, pipelineStage } from '../../../../database/schema'
import { colorForStageType } from '../../../../utils/pipeline-colors'
import { validatePipelineStages, ALL_STAGE_TYPES, bucketForType } from '../../../../utils/pipeline-validation'
import type { PipelineStageType } from '../../../../utils/pipeline-validation'

const paramsSchema = z.object({ id: z.string().min(1) })

/**
 * POST /api/pipelines/[id]/stages
 *
 * Добавляет новый этап или подстатус в существующую воронку.
 * Работает как для пользовательских, так и для системных воронок
 * (в системную воронку можно добавить кастомный этап — базовые остаются read-only).
 *
 * Тип создаваемого этапа: 'custom' по умолчанию, но можно указать любой из enum'а
 * (например, добавить ещё один 'contact' подстатус к «Первичный контакт»).
 *
 * bucket определяется автоматически по type или по parent'у, если явно не задан.
 */
const createStageSchema = z.object({
  name: z.string().min(1).max(50),
  description: z.string().max(500).optional(),
  type: z.enum(ALL_STAGE_TYPES).default('custom'),
  bucket: z.enum(['working', 'rejected']).optional(),
  isTerminal: z.boolean().default(false),
  parentStageId: z.string().uuid().nullable().optional(),
  displayOrder: z.number().int().min(0).optional(),
})

export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { pipeline: ['update'] })
  const orgId = session.session.activeOrganizationId

  const { id: pipelineId } = await getValidatedRouterParams(event, paramsSchema.parse)
  const body = await readValidatedBody(event, createStageSchema.parse)

  // Verify pipeline exists and belongs to org
  const parentPipeline = await db.query.pipeline.findFirst({
    where: and(eq(pipeline.id, pipelineId), eq(pipeline.organizationId, orgId)),
    columns: { id: true, isArchived: true },
  })

  if (!parentPipeline) {
    throw createError({ statusCode: 404, statusMessage: 'Воронка не найдена' })
  }

  if (parentPipeline.isArchived) {
    throw createError({ statusCode: 400, statusMessage: 'Нельзя добавить этап в архивную воронку' })
  }

  // ── Validate parent if provided (max 1 level nesting) ────────────
  let inheritedBucket: 'working' | 'rejected' | null = null
  if (body.parentStageId) {
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
        statusMessage: `«${parent.name}» уже является подстатусом. Максимум 1 уровень вложенности`,
      })
    }
    inheritedBucket = parent.bucket as 'working' | 'rejected'
  }

  // ── Determine bucket ────────────────────────────────────────────
  let bucket: 'working' | 'rejected'
  if (body.bucket) {
    bucket = body.bucket
  } else if (inheritedBucket) {
    bucket = inheritedBucket
  } else {
    const bucketFromType = bucketForType(body.type as PipelineStageType)
    bucket = bucketFromType === 'custom' ? 'working' : bucketFromType
  }

  // ── Validate bucket consistency with parent ────────────────────
  if (inheritedBucket && bucket !== inheritedBucket) {
    throw createError({
      statusCode: 400,
      statusMessage: `Подстатус должен быть в разделе «${inheritedBucket === 'working' ? 'В работе' : 'Отказы'}» как и родительский этап`,
    })
  }

  // ── Determine displayOrder if not provided ─────────────────────
  let displayOrder = body.displayOrder
  if (displayOrder === undefined) {
    const [maxRow] = await db
      .select({ order: pipelineStage.displayOrder })
      .from(pipelineStage)
      .where(and(
        eq(pipelineStage.pipelineId, pipelineId),
        eq(pipelineStage.organizationId, orgId),
      ))
      .orderBy(desc(pipelineStage.displayOrder))
      .limit(1)
    displayOrder = (maxRow?.order ?? -1) + 1
  }

  const newStageId = crypto.randomUUID()

  const result = await db.transaction(async (tx) => {
    const [created] = await tx.insert(pipelineStage).values({
      id: newStageId,
      organizationId: orgId,
      pipelineId,
      name: body.name,
      description: body.description ?? null,
      type: body.type,
      color: colorForStageType(body.type as PipelineStageType),
      displayOrder,
      isTerminal: body.isTerminal,
      isArchived: false,
      bucket,
      isSystemStage: false, // всегда false для пользовательских
      isHidden: false,
      parentStageId: body.parentStageId ?? null,
    }).returning()

    // Валидируем — воронка должна остаться корректной
    const allStages = await tx.query.pipelineStage.findMany({
      where: and(
        eq(pipelineStage.pipelineId, pipelineId),
        eq(pipelineStage.organizationId, orgId),
      ),
    })
    validatePipelineStages(allStages as never)

    return created
  })

  setResponseStatus(event, 201)
  return result
})
