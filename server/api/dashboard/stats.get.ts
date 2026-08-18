import { eq, and, desc, sql, count, countDistinct, inArray, asc } from 'drizzle-orm'
import { application, candidate, job, pipelineStage } from '../../database/schema'
import { resolveRecruiterScope, getJobRecruitersMap } from '../../utils/recruiterScope'

/**
 * GET /api/dashboard/stats
 * Returns aggregated dashboard data for the current organization:
 * - Summary counts (open jobs, candidates, applications, unreviewed)
 * - Pipeline breakdown (application count per status)
 * - Jobs breakdown (job count per status)
 * - Recent applications (last 10 with candidate + job info)
 * - Top active jobs (open jobs sorted by application count, top 5)
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { job: ['read'], candidate: ['read'], application: ['read'] })
  const orgId = session.session.activeOrganizationId

  // ─── Sprint 20.2: скоуп «мои вакансии» для рекрутёра (member) ───
  // Сентинел '__none__' даёт нулевые агрегаты без ветвления формы ответа (важно для типов useFetch)
  const scope = await resolveRecruiterScope(orgId, session.user.id)
  const scopedIds = scope.scoped ? (scope.jobIds.length > 0 ? scope.jobIds : ['__none__']) : null

  const jobCond = scopedIds
    ? and(eq(job.organizationId, orgId), inArray(job.id, scopedIds))!
    : eq(job.organizationId, orgId)
  const appCond = scopedIds
    ? and(eq(application.organizationId, orgId), inArray(application.jobId, scopedIds))!
    : eq(application.organizationId, orgId)

  // ─────────────────────────────────────────────
  // Run all queries in parallel for performance
  // ─────────────────────────────────────────────
  const [
    openJobsCount,
    totalCandidatesCount,
    totalApplicationsCount,
    newApplicationsCount,
    pipelineRows,
    jobStatusRows,
    recentApplications,
    topJobs,
  ] = await Promise.all([
    // 1. Open jobs count
    db.$count(job, and(jobCond, eq(job.status, 'open'))),

    // 2. Total candidates (для скоупа — уникальные кандидаты по откликам на назначенные вакансии)
    scopedIds
      ? db.select({ c: countDistinct(application.candidateId) }).from(application).where(appCond).then(rows => Number(rows[0]?.c ?? 0))
      : db.$count(candidate, eq(candidate.organizationId, orgId)),

    // 3. Total applications
    db.$count(application, appCond),

    // 4. New (unreviewed) applications
    db.$count(application, and(appCond, eq(application.status, 'new'))),

    // 5. Pipeline breakdown — application count per status
    db
      .select({
        status: application.status,
        count: count().as('count'),
      })
      .from(application)
      .where(appCond)
      .groupBy(application.status),

    // 6. Jobs by status
    db
      .select({
        status: job.status,
        count: count().as('count'),
      })
      .from(job)
      .where(jobCond)
      .groupBy(job.status),

    // 7. Recent applications (last 10) with candidate + job details
    // Фаза 1 (словарь = воронка): отдаём текущий этап вместо легаси-статуса для бейджей
    db
      .select({
        id: application.id,
        status: application.status,
        createdAt: application.createdAt,
        candidateId: application.candidateId,
        candidateFirstName: candidate.firstName,
        candidateLastName: candidate.lastName,
        candidateEmail: candidate.email,
        jobId: application.jobId,
        jobTitle: job.title,
        currentStageName: pipelineStage.name,
        currentStageColor: pipelineStage.color,
        currentStageBucket: pipelineStage.bucket,
        currentStageType: pipelineStage.type,
      })
      .from(application)
      .innerJoin(candidate, eq(candidate.id, application.candidateId))
      .innerJoin(job, eq(job.id, application.jobId))
      .leftJoin(pipelineStage, eq(pipelineStage.id, application.currentStageId))
      .where(appCond)
      .orderBy(desc(application.createdAt))
      .limit(10),

    // 8. Top 5 active (open) jobs by total application count + per-status breakdown
    db
      .select({
        id: job.id,
        title: job.title,
        slug: job.slug,
        status: job.status,
        pipelineId: job.pipelineId,
        createdAt: job.createdAt,
        applicationCount: count(application.id).as('application_count'),
        newCount: sql<number>`count(case when ${application.status} = 'new' then 1 end)`.as('new_count'),
        screeningCount: sql<number>`count(case when ${application.status} = 'screening' then 1 end)`.as('screening_count'),
        interviewCount: sql<number>`count(case when ${application.status} = 'interview' then 1 end)`.as('interview_count'),
        offerCount: sql<number>`count(case when ${application.status} = 'offer' then 1 end)`.as('offer_count'),
        hiredCount: sql<number>`count(case when ${application.status} = 'hired' then 1 end)`.as('hired_count'),
        rejectedCount: sql<number>`count(case when ${application.status} = 'rejected' then 1 end)`.as('rejected_count'),
      })
      .from(job)
      .leftJoin(application, eq(application.jobId, job.id))
      .where(and(jobCond, eq(job.status, 'open')))
      .groupBy(job.id)
      .orderBy(sql`count(${application.id}) desc`)
      // Sprint 20.2: 50 вместо 5 — owner/admin видят все открытые вакансии в разбивке по рекрутёрам
      .limit(50),
  ])

  // ─────────────────────────────────────────────
  // Transform grouped rows into keyed objects
  // ─────────────────────────────────────────────
  const pipeline: Record<string, number> = {
    new: 0,
    screening: 0,
    interview: 0,
    offer: 0,
    hired: 0,
    rejected: 0,
  }
  for (const row of pipelineRows) {
    pipeline[row.status] = row.count
  }

  const jobsByStatus: Record<string, number> = {
    draft: 0,
    open: 0,
    closed: 0,
    archived: 0,
  }
  for (const row of jobStatusRows) {
    jobsByStatus[row.status] = row.count
  }

  // ─── Sprint 10: динамические этапы для topJobs ───
  const topJobIds = topJobs.map(j => j.id)
  const topPipelineIds = [...new Set(topJobs.map(j => j.pipelineId).filter((v): v is string => !!v))]

  type StageRow = {
    id: string
    pipelineId: string
    name: string
    color: string
    type: string
    bucket: 'working' | 'rejected'
    displayOrder: number
    isHidden: boolean
    parentStageId: string | null
  }
  const stagesByPipeline: Record<string, StageRow[]> = {}
  const stageCountMap: Record<string, Record<string, number>> = {}

  if (topPipelineIds.length > 0) {
    const stageRows = await db
      .select({
        id: pipelineStage.id,
        pipelineId: pipelineStage.pipelineId,
        name: pipelineStage.name,
        color: pipelineStage.color,
        type: pipelineStage.type,
        bucket: pipelineStage.bucket,
        displayOrder: pipelineStage.displayOrder,
        isHidden: pipelineStage.isHidden,
        parentStageId: pipelineStage.parentStageId,
      })
      .from(pipelineStage)
      .where(and(
        eq(pipelineStage.organizationId, orgId),
        inArray(pipelineStage.pipelineId, topPipelineIds),
        eq(pipelineStage.isArchived, false),
      ))
      .orderBy(asc(pipelineStage.displayOrder))
    for (const row of stageRows) {
      (stagesByPipeline[row.pipelineId] ??= []).push(row as StageRow)
    }

    const stageCountRows = await db
      .select({
        jobId: application.jobId,
        stageId: application.currentStageId,
        count: count().as('count'),
      })
      .from(application)
      .where(and(
        eq(application.organizationId, orgId),
        inArray(application.jobId, topJobIds),
      ))
      .groupBy(application.jobId, application.currentStageId)
    for (const row of stageCountRows) {
      if (!row.stageId) continue
      (stageCountMap[row.jobId] ??= {})[row.stageId] = row.count
    }
  }

  function buildJobStages(pipelineId: string | null, jobId: string) {
    if (!pipelineId) return []
    const all = stagesByPipeline[pipelineId] ?? []
    if (all.length === 0) return []
    const counts = stageCountMap[jobId] ?? {}
    const roots = all.filter(s => !s.parentStageId && !s.isHidden)
    return roots.map((root) => {
      const childIds = all.filter(s => s.parentStageId === root.id).map(s => s.id)
      const total = (counts[root.id] ?? 0) + childIds.reduce((sum, cid) => sum + (counts[cid] ?? 0), 0)
      return {
        id: root.id,
        name: root.name,
        color: root.color,
        type: root.type,
        bucket: root.bucket,
        displayOrder: root.displayOrder,
        count: total,
      }
    })
  }

  // ─── Sprint 20.2: рекрутёры вакансий (для группировки на клиенте) ───
  const recruitersMap = await getJobRecruitersMap(orgId, topJobIds)

  const topJobsEnriched = topJobs.map(j => ({
    ...j,
    stages: buildJobStages(j.pipelineId, j.id),
    recruiters: recruitersMap[j.id] ?? [],
  }))

  return {
    counts: {
      openJobs: openJobsCount,
      totalCandidates: totalCandidatesCount,
      totalApplications: totalApplicationsCount,
      newApplications: newApplicationsCount,
    },
    pipeline,
    jobsByStatus,
    recentApplications,
    topJobs: topJobsEnriched,
    scope: scopedIds ? 'mine' : 'all',
  }
})
