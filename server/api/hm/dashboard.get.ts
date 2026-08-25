import { and, desc, eq, inArray, or } from 'drizzle-orm'
import { application, candidate, job, pipelineStage } from '../../database/schema/app'
import { hmDecision } from '../../database/schema/hm'
import { requireHm } from '../../utils/requireHm'
import { listJobsForHiringManager } from '../../utils/hiringManager'

/**
 * GET /api/hm/dashboard
 * Единая точка входа для НМ. Возвращает:
 *   - jobs: вакансии, где НМ назначен, с количеством «Ждут решения»
 *           и режимом очереди (reviewMode: 'queue' | 'legacy').
 *   - queue: до 100 кандидатов, у которых ещё нет эффективного решения НМ.
 *     ТЗ hm-review-substage: если в воронке вакансии есть подэтап
 *     «На рассмотрении» (preset_key='hm_review') — только кандидаты с этого
 *     подэтапа (режим 'queue'); иначе — легаси-режим: все на этапах type new/applied.
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
      pipelineId: job.pipelineId,
    })
    .from(job)
    .where(and(
      eq(job.organizationId, orgId),
      inArray(job.id, jobIds),
    ))

  // 2.1. ТЗ hm-review-substage: подэтап «На рассмотрении» пер-воронка
  const pipelineIds = [...new Set(jobsRows.map(j => j.pipelineId).filter((v): v is string => Boolean(v)))]
  const reviewStageByPipeline = new Map<string, { stageId: string; stageName: string }>()
  if (pipelineIds.length > 0) {
    const reviewRows = await db
      .select({ id: pipelineStage.id, name: pipelineStage.name, pipelineId: pipelineStage.pipelineId })
      .from(pipelineStage)
      .where(and(
        eq(pipelineStage.organizationId, orgId),
        eq(pipelineStage.presetKey, 'hm_review'),
        eq(pipelineStage.isArchived, false),
        eq(pipelineStage.isHidden, false),
        inArray(pipelineStage.pipelineId, pipelineIds),
      ))
    for (const r of reviewRows) {
      reviewStageByPipeline.set(r.pipelineId, { stageId: r.id, stageName: r.name })
    }
  }

  const queueJobIds: string[] = []
  const queueStageIds = new Set<string>()
  const legacyJobIds: string[] = []
  for (const j of jobsRows) {
    const review = j.pipelineId ? reviewStageByPipeline.get(j.pipelineId) : undefined
    if (review) {
      queueJobIds.push(j.id)
      queueStageIds.add(review.stageId)
    }
    else {
      legacyJobIds.push(j.id)
    }
  }

  const queueConditions = []
  if (queueJobIds.length > 0) {
    queueConditions.push(and(
      inArray(application.jobId, queueJobIds),
      inArray(application.currentStageId, [...queueStageIds]),
    ))
  }
  if (legacyJobIds.length > 0) {
    queueConditions.push(and(
      inArray(application.jobId, legacyJobIds),
      inArray(pipelineStage.type, ['new', 'applied']),
    ))
  }

  // 3. Кандидаты очереди по этим вакансиям (последние 100)
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
      or(...queueConditions),
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
      id: j.id,
      title: j.title,
      location: j.location,
      status: j.status,
      pendingCount: pendingByJob.get(j.id) ?? 0,
      // 'queue' — очередь «На рассмотрении»; 'legacy' — все неразобранные (старое поведение)
      reviewMode: (j.pipelineId && reviewStageByPipeline.has(j.pipelineId) ? 'queue' : 'legacy') as 'queue' | 'legacy',
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
    notices: buildNotices(session, pending.length),
  }
})

function buildNotices(session: Awaited<ReturnType<typeof requireHm>>, pendingCount: number) {
  const notices: Array<{ code: string; message: string }> = []
  if (session.hm.mustChangePassword) {
    notices.push({
      code: 'must_change_password',
      message: 'Временный пароль требует смены. Пожалуйста, установите постоянный.',
    })
  }
  // ТЗ hm-review-substage (П4): уведомление о кандидатах, ждущих решения
  if (pendingCount > 0) {
    notices.push({
      code: 'pending_review',
      message: pendingCount === 1
        ? '1 кандидат ждёт вашего решения.'
        : `Кандидатов на рассмотрении: ${pendingCount}. Они ждут вашего решения.`,
    })
  }
  return notices
}
