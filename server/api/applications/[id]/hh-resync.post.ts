import { eq, and } from 'drizzle-orm'
import { application } from '../../../database/schema'
import { pushStageChangeToHh, getHhSyncStatus } from '../../../utils/hh/sourcing/pushAction'
import { applicationIdParamSchema } from '../../../utils/schemas/application'

/**
 * POST /api/applications/:id/hh-resync
 *
 * Спринт 22 (todo 8): ручной ре-синк отклика с hh.ru.
 * Повторно пушит текущий этап воронки в hh (перевод negotiation в коллекцию
 * согласно mapping/fallback). В отличие от fire-and-forget пуша при переводе
 * этапа, здесь мы ЖДЁМ результат и возвращаем его клиенту.
 *
 * Ответ: { pushed: boolean, reason?: string, status: HhSyncStatus }
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { application: ['update'] })
  const orgId = session.session.activeOrganizationId
  const userId = session.user.id

  const { id } = await getValidatedRouterParams(event, applicationIdParamSchema.parse)

  const appRow = await db.query.application.findFirst({
    where: and(eq(application.id, id), eq(application.organizationId, orgId)),
    columns: { id: true, currentStageId: true },
  })
  if (!appRow) {
    throw createError({ statusCode: 404, statusMessage: 'Отклик не найден' })
  }
  if (!appRow.currentStageId) {
    throw createError({ statusCode: 400, statusMessage: 'У отклика нет этапа воронки — нечего синхронизировать' })
  }

  let pushed = false
  let reason: string | undefined
  try {
    const result = await pushStageChangeToHh({
      organizationId: orgId,
      applicationId: id,
      pipelineStageId: appRow.currentStageId,
      userId,
    })
    pushed = result.pushed
    reason = result.reason
  }
  catch (err) {
    // Ошибка hh уже залогирована в hh_action_log внутри pushStageChangeToHh
    pushed = false
    reason = (err as Error).message?.slice(0, 300)
  }

  const status = await getHhSyncStatus({ organizationId: orgId, applicationId: id })
  return { pushed, reason, status }
})
