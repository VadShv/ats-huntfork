import { z } from 'zod'
import { eq, and, asc } from 'drizzle-orm'
import { application, applicationStageHistory, job, pipelineStage } from '../../../database/schema'
import { moveApplicationStage } from '../../../utils/pipeline-move'
import { getEntryStageForPipeline } from '../../../utils/pipeline-helpers'
import { applicationIdParamSchema } from '../../../utils/schemas/application'

const transferBodySchema = z.object({
  targetJobId: z.string().min(1),
  comment: z.string().trim().max(2000).optional(),
})

/**
 * POST /api/applications/:id/transfer
 *
 * Спринт 22 (todo 9, M4): перевод кандидата на другую вакансию.
 *
 * 1. Создаёт НОВЫЙ отклик на целевой вакансии (входной этап её воронки,
 *    source='manual' — hh negotiation принадлежит исходной вакансии).
 * 2. Переводит СТАРЫЙ отклик на этап типа transferred («Переведён на другую
 *    вакансию») через общий moveApplicationStage (история, activity, PostHog).
 *    На hh это НЕ пушится (transferred → null): перевод — не отказ,
 *    кандидату не должно уйти отказное сообщение.
 * 3. Связывает старый отклик с новым через transferredToApplicationId.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { application: ['update'] })
  const orgId = session.session.activeOrganizationId
  const userId = session.user.id

  const { id } = await getValidatedRouterParams(event, applicationIdParamSchema.parse)
  const body = await readValidatedBody(event, transferBodySchema.parse)

  const appRow = await db.query.application.findFirst({
    where: and(eq(application.id, id), eq(application.organizationId, orgId)),
    columns: {
      id: true,
      candidateId: true,
      jobId: true,
      currentStageId: true,
      transferredToApplicationId: true,
    },
  })
  if (!appRow) {
    throw createError({ statusCode: 404, statusMessage: 'Отклик не найден' })
  }
  if (appRow.transferredToApplicationId) {
    throw createError({ statusCode: 409, statusMessage: 'Отклик уже переведён на другую вакансию' })
  }
  if (appRow.jobId === body.targetJobId) {
    throw createError({ statusCode: 400, statusMessage: 'Кандидат уже на этой вакансии' })
  }

  const targetJob = await db.query.job.findFirst({
    where: and(eq(job.id, body.targetJobId), eq(job.organizationId, orgId)),
    columns: { id: true, title: true, pipelineId: true },
  })
  if (!targetJob) {
    throw createError({ statusCode: 404, statusMessage: 'Целевая вакансия не найдена' })
  }

  // Дубликат: уникальный индекс org+candidate+job
  const duplicate = await db.query.application.findFirst({
    where: and(
      eq(application.organizationId, orgId),
      eq(application.candidateId, appRow.candidateId),
      eq(application.jobId, body.targetJobId),
    ),
    columns: { id: true },
  })
  if (duplicate) {
    throw createError({
      statusCode: 409,
      statusMessage: 'У кандидата уже есть отклик на целевой вакансии',
      data: { code: 'DUPLICATE_APPLICATION', existingApplicationId: duplicate.id },
    })
  }

  // Этап transferred в воронке ИСХОДНОЙ вакансии (предпочитаем подэтап «Отказа»)
  const sourceJob = await db.query.job.findFirst({
    where: and(eq(job.id, appRow.jobId), eq(job.organizationId, orgId)),
    columns: { id: true, title: true, pipelineId: true },
  })
  let transferredStageId: string | null = null
  if (sourceJob?.pipelineId) {
    const candidates = await db
      .select({ id: pipelineStage.id, parentStageId: pipelineStage.parentStageId })
      .from(pipelineStage)
      .where(and(
        eq(pipelineStage.pipelineId, sourceJob.pipelineId),
        eq(pipelineStage.type, 'transferred'),
        eq(pipelineStage.isArchived, false),
      ))
      .orderBy(asc(pipelineStage.displayOrder))
    transferredStageId
      = candidates.find(s => s.parentStageId != null)?.id
        ?? candidates[0]?.id
        ?? null
  }
  if (!transferredStageId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'В воронке текущей вакансии нет этапа «Переведён на другую вакансию». Добавьте его в настройках воронки.',
      data: { code: 'NO_TRANSFERRED_STAGE' },
    })
  }

  // Входной этап воронки целевой вакансии
  let entryStageId: string | null = null
  if (targetJob.pipelineId) {
    const entry = await getEntryStageForPipeline(db, targetJob.pipelineId)
    entryStageId = entry?.id ?? null
  }

  const now = new Date()

  // 1. Новый отклик на целевой вакансии
  const [created] = await db.insert(application).values({
    organizationId: orgId,
    candidateId: appRow.candidateId,
    jobId: body.targetJobId,
    status: 'new',
    currentStageId: entryStageId,
    stageChangedAt: entryStageId ? now : null,
    source: 'manual',
    notes: body.comment
      ? `Переведён с вакансии «${sourceJob?.title ?? '—'}»: ${body.comment}`
      : `Переведён с вакансии «${sourceJob?.title ?? '—'}»`,
  }).returning({ id: application.id })

  if (!created) {
    throw createError({ statusCode: 500, statusMessage: 'Не удалось создать отклик на целевой вакансии' })
  }

  if (entryStageId) {
    await db.insert(applicationStageHistory).values({
      organizationId: orgId,
      applicationId: created.id,
      fromStageId: null,
      toStageId: entryStageId,
      movedByUserId: userId,
      movedAt: now,
    })
  }

  recordActivity({
    organizationId: orgId,
    actorId: userId,
    action: 'created',
    resourceType: 'application',
    resourceId: created.id,
    metadata: {
      candidateId: appRow.candidateId,
      jobId: body.targetJobId,
      transferredFromApplicationId: appRow.id,
      transferredFromJobId: appRow.jobId,
    },
  })

  // 2. Старый отклик → этап transferred (история/activity/PostHog в утили;
  //    hh-пуш — no-op: transferred → null в fallback-маппинге)
  const moveResult = await moveApplicationStage({
    organizationId: orgId,
    applicationId: appRow.id,
    toStageId: transferredStageId,
    actorUserId: userId,
    comment: body.comment,
    via: 'transfer',
    activityMetadataExtras: {
      transferredToApplicationId: created.id,
      targetJobId: body.targetJobId,
      targetJobTitle: targetJob.title,
    },
  })

  // 3. Связь старый → новый
  await db.update(application)
    .set({ transferredToApplicationId: created.id, updatedAt: new Date() })
    .where(and(eq(application.id, appRow.id), eq(application.organizationId, orgId)))

  return {
    newApplicationId: created.id,
    targetJobId: body.targetJobId,
    targetJobTitle: targetJob.title,
    move: {
      toStageId: moveResult.toStageId,
      toStageName: moveResult.toStageName,
      toParentStageName: moveResult.toParentStageName,
    },
  }
})
