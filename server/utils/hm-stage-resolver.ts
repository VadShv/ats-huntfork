/**
 * Резолвер целевых этапов для решений НМ.
 *
 * Логика:
 *   - «Одобрено» — следующий рабочий (bucket='working') не-скрытый не-архивный этап
 *     после текущего этапа заявки по displayOrder.
 *   - «Отклонено» — терминальный этап типа 'not_fit' (bucket='rejected'),
 *     не скрытый и не архивный. Если несколько — берём с минимальным displayOrder.
 *
 * Если нужного этапа нет — 400 с понятным сообщением (админ должен настроить воронку).
 */

import { and, asc, eq, gt, isNull } from 'drizzle-orm'
import { application, job, pipelineStage } from '../database/schema/app'

/** Найти этап, куда переносит «Одобрено НМ». */
export async function resolveApprovedTargetStage(params: {
  organizationId: string
  applicationId: string
}): Promise<{ stageId: string; stageName: string }> {
  const { organizationId, applicationId } = params

  // 1. Заявка → job → pipeline
  const app = await db.query.application.findFirst({
    where: and(eq(application.id, applicationId), eq(application.organizationId, organizationId)),
    columns: { id: true, currentStageId: true, jobId: true },
  })
  if (!app) throw createError({ statusCode: 404, statusMessage: 'Отклик не найден' })

  const jobRow = await db.query.job.findFirst({
    where: eq(job.id, app.jobId),
    columns: { id: true, pipelineId: true },
  })
  if (!jobRow?.pipelineId) {
    throw createError({ statusCode: 400, statusMessage: 'У вакансии не задана воронка' })
  }

  // 2. Текущий этап + его displayOrder
  let currentOrder = -1
  if (app.currentStageId) {
    const cur = await db.query.pipelineStage.findFirst({
      where: eq(pipelineStage.id, app.currentStageId),
      columns: { displayOrder: true },
    })
    currentOrder = cur?.displayOrder ?? -1
  }

  // 3. Следующий working этап
  const [next] = await db
    .select({
      id: pipelineStage.id,
      name: pipelineStage.name,
      displayOrder: pipelineStage.displayOrder,
    })
    .from(pipelineStage)
    .where(and(
      eq(pipelineStage.pipelineId, jobRow.pipelineId),
      eq(pipelineStage.organizationId, organizationId),
      eq(pipelineStage.bucket, 'working'),
      eq(pipelineStage.isArchived, false),
      eq(pipelineStage.isHidden, false),
      // Спринт 22: «следующий этап» — только корневой (не подэтап)
      isNull(pipelineStage.parentStageId),
      gt(pipelineStage.displayOrder, currentOrder),
    ))
    .orderBy(asc(pipelineStage.displayOrder))
    .limit(1)

  if (!next) {
    throw createError({
      statusCode: 400,
      statusMessage: 'В воронке нет следующего рабочего этапа. Настройте воронку в вакансии.',
    })
  }

  return { stageId: next.id, stageName: next.name }
}

/** Найти терминальный этап отказа для «Отклонено НМ». */
export async function resolveRejectedTargetStage(params: {
  organizationId: string
  jobId: string
}): Promise<{ stageId: string; stageName: string }> {
  const { organizationId, jobId } = params

  const jobRow = await db.query.job.findFirst({
    where: eq(job.id, jobId),
    columns: { id: true, pipelineId: true },
  })
  if (!jobRow?.pipelineId) {
    throw createError({ statusCode: 400, statusMessage: 'У вакансии не задана воронка' })
  }

  // Спринт 22: после миграции 0062 причины отказа — подэтапы родителя «Отказ».
  // Ищем 'not_fit' (предпочитая подэтап), иначе fallback на rejected-bucket без родителя с подэтапами.
  const notFitRows = await db
    .select({
      id: pipelineStage.id,
      name: pipelineStage.name,
      parentStageId: pipelineStage.parentStageId,
    })
    .from(pipelineStage)
    .where(and(
      eq(pipelineStage.pipelineId, jobRow.pipelineId),
      eq(pipelineStage.organizationId, organizationId),
      eq(pipelineStage.type, 'not_fit'),
      eq(pipelineStage.isArchived, false),
      eq(pipelineStage.isHidden, false),
    ))
    .orderBy(asc(pipelineStage.displayOrder))

  const notFit = notFitRows.find(s => s.parentStageId !== null) ?? notFitRows[0]
  if (notFit) return { stageId: notFit.id, stageName: notFit.name }

  // Fallback — любой терминальный rejected-этап (предпочитая подэтап-причину)
  const rejectedRows = await db
    .select({
      id: pipelineStage.id,
      name: pipelineStage.name,
      parentStageId: pipelineStage.parentStageId,
    })
    .from(pipelineStage)
    .where(and(
      eq(pipelineStage.pipelineId, jobRow.pipelineId),
      eq(pipelineStage.organizationId, organizationId),
      eq(pipelineStage.bucket, 'rejected'),
      eq(pipelineStage.isArchived, false),
      eq(pipelineStage.isHidden, false),
      eq(pipelineStage.isTerminal, true),
    ))
    .orderBy(asc(pipelineStage.displayOrder))

  const anyRejected = rejectedRows.find(s => s.parentStageId !== null) ?? rejectedRows[0]
  if (anyRejected) return { stageId: anyRejected.id, stageName: anyRejected.name }

  throw createError({
    statusCode: 400,
    statusMessage: 'В воронке нет терминального этапа отказа. Настройте воронку в вакансии.',
  })
}
