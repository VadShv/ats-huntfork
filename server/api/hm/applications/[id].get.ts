import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { application, candidate, job, pipelineStage } from '../../../database/schema/app'
import { hmDecision } from '../../../database/schema/hm'
import { requireHm } from '../../../utils/requireHm'
import { isHiringManagerOnJob } from '../../../utils/hiringManager'

const paramsSchema = z.object({
  id: z.string().min(1).max(64),
})

/**
 * GET /api/hm/applications/[id]
 *
 * Read-only карточка кандидата для НМ.
 * Возвращает только то, что НМ разрешено видеть по ТЗ v1.1:
 *   - Кандидат (ФИО, город, коротко резюме через AI-summary или hh raw).
 *   - Заявка (текущий этап, дата создания).
 *   - Вакансия (заголовок, локация).
 *   - Зарплатные ожидания — только если member.hm_can_view_salary=true.
 *   - Существующее эффективное решение НМ (для UI кнопок «отменить/уже решено»).
 *
 * НЕ возвращает: внутренние комментарии (is_internal), скоринг, аудит, PII не относящуюся к делу.
 */
export default defineEventHandler(async (event) => {
  const session = await requireHm(event)
  const orgId = session.session.activeOrganizationId

  const { id: applicationId } = await getValidatedRouterParams(event, paramsSchema.parse)

  // 1. Загружаем заявку + связи
  const [row] = await db
    .select({
      appId: application.id,
      appStatus: application.status,
      appCreatedAt: application.createdAt,
      appNotes: application.notes,
      currentStageId: application.currentStageId,
      stageChangedAt: application.stageChangedAt,

      candidateId: candidate.id,
      firstName: candidate.firstName,
      lastName: candidate.lastName,
      displayName: candidate.displayName,
      city: candidate.city,
      aiSummary: candidate.aiSummary,
      hhResumeRaw: candidate.hhResumeRaw,

      jobId: job.id,
      jobTitle: job.title,
      jobLocation: job.location,

      stageName: pipelineStage.name,
      stageType: pipelineStage.type,
    })
    .from(application)
    .innerJoin(candidate, eq(candidate.id, application.candidateId))
    .innerJoin(job, eq(job.id, application.jobId))
    .leftJoin(pipelineStage, eq(pipelineStage.id, application.currentStageId))
    .where(and(
      eq(application.id, applicationId),
      eq(application.organizationId, orgId),
    ))
    .limit(1)

  if (!row) {
    throw createError({ statusCode: 404, statusMessage: 'Отклик не найден' })
  }

  // 2. НМ должен быть назначен на эту вакансию
  const isAssigned = await isHiringManagerOnJob(orgId, session.user.id, row.jobId)
  if (!isAssigned) {
    throw createError({ statusCode: 403, statusMessage: 'Нет доступа к этой вакансии' })
  }

  // 3. Существующее эффективное решение НМ (любого — не только текущего)
  const [effective] = await db
    .select({
      id: hmDecision.id,
      decision: hmDecision.decision,
      hmUserId: hmDecision.hmUserId,
      decidedAt: hmDecision.decidedAt,
      comment: hmDecision.comment,
    })
    .from(hmDecision)
    .where(and(
      eq(hmDecision.applicationId, applicationId),
      eq(hmDecision.isEffective, true),
    ))
    .limit(1)

  // 4. Извлекаем зарплатные ожидания из hh_resume_raw
  let expectedSalary: { amount?: number; currency?: string } | null = null
  if (session.hm.canViewSalary && row.hhResumeRaw && typeof row.hhResumeRaw === 'object') {
    const raw = row.hhResumeRaw as any
    if (raw?.salary && (raw.salary.amount || raw.salary.value)) {
      expectedSalary = {
        amount: raw.salary.amount ?? raw.salary.value,
        currency: raw.salary.currency,
      }
    }
  }

  const isOnNewStage = row.stageType === 'new' || row.stageType === 'applied'

  return {
    application: {
      id: row.appId,
      status: row.appStatus,
      createdAt: row.appCreatedAt,
      stageChangedAt: row.stageChangedAt,
      currentStage: row.stageName
        ? { name: row.stageName, type: row.stageType }
        : null,
      isOnNewStage,
    },
    candidate: {
      id: row.candidateId,
      fullName: row.displayName || `${row.firstName} ${row.lastName}`.trim(),
      city: row.city,
      aiSummary: row.aiSummary,
      expectedSalary,
    },
    job: {
      id: row.jobId,
      title: row.jobTitle,
      location: row.jobLocation,
    },
    effectiveDecision: effective ?? null,
    /** true = НМ может нажимать «Одобрить/Отклонить». */
    canDecide: isOnNewStage && !effective,
    permissions: {
      canViewSalary: session.hm.canViewSalary,
    },
  }
})
