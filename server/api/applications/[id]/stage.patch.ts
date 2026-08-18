import { z } from 'zod'
import { moveApplicationStage } from '../../../utils/pipeline-move'
import { applicationIdParamSchema } from '../../../utils/schemas/application'

/**
 * PATCH /api/applications/:id/stage
 * Перенос заявки на другой этап воронки.
 *
 * Спринт 22: тонкая обёртка над каноническим утилём moveApplicationStage —
 * вся логика (guards, история, legacy-статус, activity, hh-push, PostHog) внутри него.
 */

const moveStageBodySchema = z.object({
  stageId: z.string().min(1),
  comment: z.string().max(500).optional(),
})

export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { application: ['update'] })
  const orgId = session.session.activeOrganizationId

  const { id } = await getValidatedRouterParams(event, applicationIdParamSchema.parse)
  const body = await readValidatedBody(event, moveStageBodySchema.parse)

  const result = await moveApplicationStage({
    organizationId: orgId,
    applicationId: id,
    toStageId: body.stageId,
    actorUserId: session.user.id,
    comment: body.comment,
    via: 'manual',
  })

  return {
    id: result.applicationId,
    currentStageId: result.noop ? result.fromStageId : result.toStageId,
    stageChangedAt: result.stageChangedAt,
    currentStageName: result.toStageName,
    currentStageColor: result.toStageColor,
    // Спринт 22: родитель целевого этапа — для тостов «Отказ → Не подходит»
    currentStageParentName: result.toParentStageName,
  }
})
