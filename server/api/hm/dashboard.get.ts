import { and, desc, eq, inArray } from 'drizzle-orm'
import { application, candidate, job, pipelineStage } from '../../database/schema/app'
import { hmDecision } from '../../database/schema/hm'
import { requireHm } from '../../utils/requireHm'
import { listJobsForHiringManager } from '../../utils/hiringManager'

/**
 * GET /api/hm/dashboard
 * Единая точка входа для НМ. Возвращает:
 *   - jobs: вакансии, где НМ назначен, с количеством «Ждут решения».
 *   - queue: до 100 кандидатов на этапе `new` из этих вакансий,
 *            у которых ещё нет эффективного решения НМ.
 *   - notices: подсказки для UI (например, must_change_password).
 */
export default defineEventHandler(async (event) => {
  const session = await requireHm(event)
  const orgId = session.session.activeOrganizationId

  // 1. Вакансии этого НМ
  const jobIds = await listJobsForHiringManager(orgId, session.user.id)

  if (jobIds.length === 0) {
    return {
      jobs: [],
      queue: [],
      notices: buildNotices(session),
    }
  }

  // 2. Список вакансий с базовой инфой
  const jobsRows = await db
    .select({
      id: job.id,
      title: job.title,
      location: job.location,
      status: job.status,
    })
    .from(job)
    .where(and(
      eq(job.organizationId, orgId),
      inArray(job.id, jobIds),
    ))

  // 3. Кандидаты в `new` по этим вакансиям (последние 100)
  const queueRows = await db
    .select({
      appId: application.id,
      appCreatedAt: application.createdAt,
      stageChangedAt: application.stageChangedAt,
      candidateId: candidate.id,
      firstName: candidate.firstName,
      lastName: candidate.lastName,
      displayName: candidate.displayName,
      city: candidate.city,
      jobId: job.id,
      jobTitle: job.title,
      stageType: pipelineStage.type,
    })
    .from(application)
    .innerJoin(candidate, eq(candidate.id, application.candidateId))
    .innerJoin(job, eq(job.id, application.jobId))
    .innerJoin(pipelineStage, eq(pipelineStage.id, application.currentStageId))
    .where(and(
      eq(application.organizationId, orgId),
      inArray(application.jobId, jobIds),
      inArray(pipelineStage.type, ['new', 'applied']),
    ))
    .orderBy(desc(application.createdAt))
    .limit(100)

  // 4. Убираем те, по которым уже есть эффективное решение НМ
  const appIds = queueRows.map(r => r.appId)
  let decidedIds = new Set<string>()
  if (appIds.length > 0) {
    const decided = await db
      .select({ applicationId: hmDecision.applicationId })
      .from(hmDecision)
      .where(and(
        eq(hmDecision.organizationId, orgId),
        eq(hmDecision.isEffective, true),
        inArray(hmDecision.applicationId, appIds),
      ))
    decidedIds = new Set(decided.map(d => d.applicationId))
  }

  const pending = queueRows.filter(r => !decidedIds.has(r.appId))

  // 5. Считаем pending per-job
  const pendingByJob = new Map<string, number>()
  for (const r of pending) {
    pendingByJob.set(r.jobId, (pendingByJob.get(r.jobId) ?? 0) + 1)
  }

  return {
    jobs: jobsRows.map(j => ({
      ...j,
      pendingCount: pendingByJob.get(j.id) ?? 0,
    })),
    queue: pending.map(r => ({
      applicationId: r.appId,
      candidateId: r.candidateId,
      fullName: r.displayName || `${r.firstName} ${r.lastName}`.trim(),
      city: r.city,
      job: { id: r.jobId, title: r.jobTitle },
      createdAt: r.appCreatedAt,
      stageChangedAt: r.stageChangedAt,
    })),
    notices: buildNotices(session),
  }
})

function buildNotices(session: Awaited<ReturnType<typeof requireHm>>) {
  const notices: Array<{ code: string; message: string }> = []
  if (session.hm.mustChangePassword) {
    notices.push({
      code: 'must_change_password',
      message: 'Временный пароль требует смены. Пожалуйста, установите постоянный.',
    })
  }
  return notices
}
