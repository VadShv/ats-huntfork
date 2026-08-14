import { z } from 'zod'
import { eq, and } from 'drizzle-orm'
import { pipeline, pipelineStage } from '../../../database/schema'

const idParamSchema = z.object({ id: z.string().min(1) })

const cloneBodySchema = z.object({
  name: z.string().min(1).max(100).optional(),
})

/**
 * POST /api/pipelines/[id]/clone
 *
 * Клонирует воронку в новую пользовательскую (isSystem=false, isDefault=false).
 * Все этапы копируются с сохранением иерархии (parentStageId), но становятся
 * не-системными (isSystemStage=false) — в клоне пользователь может редактировать/удалять
 * любые этапы. Флаг isHidden сбрасывается.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { pipeline: ['create'] })
  const orgId = session.session.activeOrganizationId

  const { id } = await getValidatedRouterParams(event, idParamSchema.parse)
  const body = await readValidatedBody(event, cloneBodySchema.parse)

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
          id: true,
          name: true,
          description: true,
          type: true,
          bucket: true,
          color: true,
          displayOrder: true,
          isTerminal: true,
          parentStageId: true,
        },
        orderBy: (s, { asc }) => [asc(s.displayOrder)],
      },
    },
  })

  if (!source) {
    throw createError({ statusCode: 404, statusMessage: 'Воронка не найдена' })
  }

  const newName = body.name ?? `${source.name} (копия)`
  const newPipelineId = crypto.randomUUID()

  // Маппим старые stageId → новые, чтобы parentStageId перепривязать
  const idMap = new Map<string, string>()
  for (const s of source.stages) {
    idMap.set(s.id, crypto.randomUUID())
  }

  const result = await db.transaction(async (tx) => {
    const [created] = await tx.insert(pipeline).values({
      id: newPipelineId,
      organizationId: orgId,
      name: newName,
      description: source.description,
      isSystem: false,
      isDefault: false,
      isArchived: false,
    }).returning()

    if (!created) {
      throw createError({ statusCode: 500, statusMessage: 'Не удалось клонировать воронку' })
    }

    const stageValues = source.stages.map((stage, index: number) => ({
      id: idMap.get(stage.id)!,
      organizationId: orgId,
      pipelineId: newPipelineId,
      name: stage.name,
      description: stage.description,
      type: stage.type,
      bucket: stage.bucket,
      color: stage.color,
      displayOrder: index,
      isTerminal: stage.isTerminal,
      isArchived: false,
      isSystemStage: false, // клон всегда пользовательский
      isHidden: false,      // сбрасываем скрытие
      parentStageId: stage.parentStageId ? idMap.get(stage.parentStageId) ?? null : null,
    }))

    const insertedStages = await tx.insert(pipelineStage).values(stageValues).returning()

    return { ...created, stages: insertedStages }
  })

  setResponseStatus(event, 201)
  return result
})
