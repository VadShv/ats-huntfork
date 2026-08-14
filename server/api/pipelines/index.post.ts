import { z } from 'zod'
import { eq, and, ilike } from 'drizzle-orm'
import { pipeline, pipelineStage } from '../../database/schema'
import { colorForStageType } from '../../utils/pipeline-colors'
import {
  validatePipelineStages,
  ALL_STAGE_TYPES,
  bucketForType,
  isTerminalTypeDefault,
} from '../../utils/pipeline-validation'
import type { PipelineStageType } from '../../utils/pipeline-validation'
import { HH_STANDARD_STAGES, SIMPLE_STAGES } from '../../utils/pipeline-seed'

/**
 * POST /api/pipelines
 *
 * Создаёт новую пользовательскую воронку (isSystem=false).
 * Этапы поддерживают:
 *   - полный enum type (16 значений)
 *   - bucket (working/rejected) — определяется по type, если не задан
 *   - иерархия через parentStageId (макс 1 уровень) — передаётся клиентский локальный
 *     ключ tempId, а не UUID; сервер их резолвит в реальные id
 */
const stageInputSchema = z.object({
  tempId: z.string().min(1).optional(), // локальный id для parent-мэппинга в этом запросе
  name: z.string().min(1).max(50),
  description: z.string().max(500).optional(),
  type: z.enum(ALL_STAGE_TYPES).default('custom'),
  bucket: z.enum(['working', 'rejected']).optional(),
  isTerminal: z.boolean().optional(),
  parentTempId: z.string().optional().nullable(),
})

const createPipelineSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  // Спринт 11.2: пресет — сервер строит этапы из pipeline-seed.ts (isSystemStage=true).
  // Если preset задан, stages игнорируются.
  preset: z.enum(['hh_standard', 'simple']).optional(),
  stages: z.array(stageInputSchema).min(2).max(50).optional(),
}).refine(
  (b) => Boolean(b.preset) || (Array.isArray(b.stages) && b.stages.length >= 2),
  { message: 'Укажите пресет или минимум 2 этапа' },
)

export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { pipeline: ['create'] })
  const orgId = session.session.activeOrganizationId

  const body = await readValidatedBody(event, createPipelineSchema.parse)

  // ── Name uniqueness (общая проверка для обеих веток) ────────────
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

  // ── Спринт 11.2: создание из пресета ─────────────────────────────
  if (body.preset) {
    const seedStages = body.preset === 'hh_standard' ? HH_STANDARD_STAGES : SIMPLE_STAGES

    const presetPipelineId = crypto.randomUUID()
    const keyToId = new Map<string, string>()
    for (const s of seedStages) keyToId.set(s.key, crypto.randomUUID())

    const presetResult = await db.transaction(async (tx) => {
      const [created] = await tx.insert(pipeline).values({
        id: presetPipelineId,
        organizationId: orgId,
        name: body.name,
        description: body.description,
        isSystem: false,
        isDefault: false,
        isArchived: false,
      }).returning()

      const stageValues = seedStages.map((stage) => {
        const { key, parentKey, ...rest } = stage
        return {
          ...rest,
          id: keyToId.get(key)!,
          organizationId: orgId,
          pipelineId: presetPipelineId,
          parentStageId: parentKey ? keyToId.get(parentKey) ?? null : null,
        }
      })

      const insertedStages = await tx.insert(pipelineStage).values(stageValues).returning()

      return { ...created, stages: insertedStages }
    })

    setResponseStatus(event, 201)
    return presetResult
  }

  // ── Ветка «С нуля»: пользовательские этапы ────────────────────────
  const bodyStages = body.stages!

  // ── Резолв tempId → UUID и подготовка stages для валидатора ─────
  const tempIdToUuid = new Map<string, string>()
  for (const s of bodyStages) {
    if (s.tempId) tempIdToUuid.set(s.tempId, crypto.randomUUID())
  }

  const stagesForValidation = bodyStages.map((s) => {
    const id = s.tempId ? tempIdToUuid.get(s.tempId) : undefined
    const parentStageId = s.parentTempId ? tempIdToUuid.get(s.parentTempId) ?? null : null
    const typeBucket = bucketForType(s.type as PipelineStageType)
    const bucket = s.bucket ?? (typeBucket === 'custom' ? 'working' : typeBucket)
    return {
      id,
      name: s.name,
      type: s.type,
      bucket,
      isTerminal: s.isTerminal ?? isTerminalTypeDefault(s.type as PipelineStageType),
      parentStageId,
      isSystemStage: false,
      isHidden: false,
      isArchived: false,
    }
  })

  validatePipelineStages(stagesForValidation)

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
    }).returning()

    const stageValues = stagesForValidation.map((stage, index: number) => ({
      id: stage.id ?? crypto.randomUUID(),
      organizationId: orgId,
      pipelineId,
      name: stage.name,
      description: bodyStages[index]?.description ?? null,
      type: stage.type as PipelineStageType,
      bucket: stage.bucket as 'working' | 'rejected',
      isTerminal: stage.isTerminal,
      color: colorForStageType(stage.type as PipelineStageType),
      displayOrder: index,
      isArchived: false,
      isSystemStage: false,
      isHidden: false,
      parentStageId: stage.parentStageId,
    }))

    const insertedStages = await tx.insert(pipelineStage).values(stageValues).returning()

    return { ...created, stages: insertedStages }
  })

  setResponseStatus(event, 201)
  return result
})
