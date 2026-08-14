import { eq, and } from 'drizzle-orm'
import { job } from '../../../database/schema'
import { idParamSchema } from '../../../utils/schemas/job'

/**
 * DELETE /api/jobs/[id]/pipeline-snapshot
 *
 * Сбрасывает per-vacancy кастомизацию воронки, возвращая вакансию к живой
 * (базовой) воронке. Snapshot удаляется, но заявки на этапах остаются
 * привязаны к currentStageId — если этот этап всё ещё существует в живой
 * воронке, всё продолжит работать.
 *
 * WARN: если пользователь добавил в snapshot кастомные этапы и на них есть
 * заявки, после сброса эти заявки останутся с currentStageId, указывающим
 * на несуществующий (только в snapshot) этап. UI должен предупредить перед
 * DELETE и предложить переместить заявки.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { job: ['update'] })
  const orgId = session.session.activeOrganizationId

  const { id } = await getValidatedRouterParams(event, idParamSchema.parse)

  const existingJob = await db.query.job.findFirst({
    where: and(eq(job.id, id), eq(job.organizationId, orgId)),
    columns: { id: true, pipelineSnapshotJson: true },
  })

  if (!existingJob) {
    throw createError({ statusCode: 404, statusMessage: 'Вакансия не найдена' })
  }

  if (!existingJob.pipelineSnapshotJson) {
    // No snapshot — already on live pipeline
    return { ok: true, wasSnapshot: false }
  }

  await db.update(job)
    .set({
      pipelineSnapshotJson: null,
      updatedAt: new Date(),
    })
    .where(and(eq(job.id, id), eq(job.organizationId, orgId)))

  setResponseStatus(event, 200)
  return { ok: true, wasSnapshot: true }
})
