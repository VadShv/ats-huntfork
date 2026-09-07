import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import {
  application,
  applicationComment,
  candidate,
  job,
  pipelineStage,
} from '../../../database/schema'
import { candidateIdParamSchema } from '../../../utils/schemas/risk'

/**
 * GET /api/candidates/:id/discussion-tabs
 *
 * Collaboration Hub (Этап 1) — источник вкладок «Обсуждение» по всем откликам
 * кандидата. Возвращает лёгкий список откликов с контекстом вакансии, этапа
 * воронки (имя/цвет/bucket) и счётчиком НЕ удалённых комментариев в треде.
 *
 * Писать разрешено только в текущий отклик (решается на клиенте + серверными
 * guard'ами существующих POST/PATCH/DELETE); здесь — только чтение для вкладок.
 * Счётчик считается одним GROUP BY (без N+1).
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { application: ['read'] })
  const orgId = session.session.activeOrganizationId

  const { id } = await getValidatedRouterParams(event, candidateIdParamSchema.parse)

  // ── 1. Verify candidate belongs to org ──
  const candidateRow = await db.query.candidate.findFirst({
    where: and(eq(candidate.id, id), eq(candidate.organizationId, orgId)),
    columns: { id: true },
  })
  if (!candidateRow) {
    throw createError({ statusCode: 404, statusMessage: 'Кандидат не найден' })
  }

  // ── 2. All applications of the candidate (org-scoped) with job + stage ──
  const apps = await db
    .select({
      id: application.id,
      jobId: application.jobId,
      jobTitle: job.title,
      jobStatus: job.status,
      currentStageId: application.currentStageId,
      stageName: pipelineStage.name,
      stageColor: pipelineStage.color,
      stageBucket: pipelineStage.bucket,
      stageType: pipelineStage.type,
      isTerminal: pipelineStage.isTerminal,
      createdAt: application.createdAt,
      updatedAt: application.updatedAt,
    })
    .from(application)
    .innerJoin(job, eq(job.id, application.jobId))
    .leftJoin(pipelineStage, eq(pipelineStage.id, application.currentStageId))
    .where(and(eq(application.candidateId, id), eq(application.organizationId, orgId)))
    .orderBy(desc(application.createdAt))

  if (apps.length === 0) {
    return { data: [] }
  }

  // ── 3. Comment counts per application (single GROUP BY, exclude soft-deleted) ──
  const appIds = apps.map(a => a.id)
  const counts = await db
    .select({
      applicationId: applicationComment.applicationId,
      count: sql<number>`count(*)::int`,
    })
    .from(applicationComment)
    .where(and(
      eq(applicationComment.organizationId, orgId),
      inArray(applicationComment.applicationId, appIds),
      isNull(applicationComment.deletedAt),
    ))
    .groupBy(applicationComment.applicationId)

  const countByApp = new Map<string, number>()
  for (const c of counts) countByApp.set(c.applicationId, c.count)

  return {
    data: apps.map(a => ({
      id: a.id,
      jobId: a.jobId,
      jobTitle: a.jobTitle,
      jobStatus: a.jobStatus,
      stage: a.currentStageId
        ? {
            id: a.currentStageId,
            name: a.stageName,
            color: a.stageColor,
            bucket: a.stageBucket,
            type: a.stageType,
            isTerminal: Boolean(a.isTerminal),
          }
        : null,
      commentCount: countByApp.get(a.id) ?? 0,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
    })),
  }
})
