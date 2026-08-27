import { eq, and, desc, count, inArray, asc } from 'drizzle-orm'
import { job, application, hhVacancyLink, pipelineStage } from '../../database/schema'
import { jobQuerySchema } from '../../utils/schemas/job'
import { resolveRecruiterScope, getJobRecruitersMap } from '../../utils/recruiterScope'

interface PipelineCounts {
  new: number
  screening: number
  interview: number
  offer: number
  hired: number
  rejected: number
}

export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { job: ['read'] })
  const orgId = session.session.activeOrganizationId

  const query = await getValidatedQuery(event, jobQuerySchema.parse)

  // ─── Sprint 20.2: скоуп «мои вакансии» — рекрутер (member) по умолчанию видит только назначенные ───
  // Сентинел '__none__' даёт пустую выдачу без ветвления формы ответа (важно для типов useFetch)
  const scope = await resolveRecruiterScope(orgId, session.user.id, query.scope)

  const offset = (query.page - 1) * query.limit
  const conditions = [eq(job.organizationId, orgId)]
  if (query.status) conditions.push(eq(job.status, query.status))
  if (scope.scoped) conditions.push(inArray(job.id, scope.jobIds.length > 0 ? scope.jobIds : ['__none__']))

  const [data, total] = await Promise.all([
    db.query.job.findMany({
      where: and(...conditions),
      limit: query.limit,
      offset,
      orderBy: [desc(job.createdAt)],
      columns: {
        id: true,
        title: true,
        slug: true,
        description: true,
        location: true,
        type: true,
        status: true,
        experienceLevel: true,
        remoteStatus: true,
        pipelineId: true,
        createdAt: true,
        updatedAt: true,
      },
      with: {
        pipeline: {
          columns: { id: true, name: true },
        },
      },
    }),
    db.$count(job, and(...conditions)),
  ])

  // Fetch pipeline counts (application status breakdown) for returned jobs
  const jobIds = data.map((j) => j.id)
  let pipelineMap: Record<string, PipelineCounts> = {}

  if (jobIds.length > 0) {
    const pipelineRows = await db
      .select({
        jobId: application.jobId,
        status: application.status,
        count: count().as('count'),
      })
      .from(application)
      .where(and(
        eq(application.organizationId, orgId),
        inArray(application.jobId, jobIds),
      ))
      .groupBy(application.jobId, application.status)

    for (const row of pipelineRows) {
      const entry = (pipelineMap[row.jobId] ??= { new: 0, screening: 0, interview: 0, offer: 0, hired: 0, rejected: 0 })
      entry[row.status as keyof PipelineCounts] = row.count
    }
  }

  // ─── Sprint 10: динамические этапы воронки + счётчики по current_stage_id ───
  const pipelineIds = [...new Set(data.map(j => j.pipelineId).filter((v): v is string => !!v))]

  // Этапы всех воронок списка (включая подстатусы — для roll-up счётчиков)
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
  let stagesByPipeline: Record<string, StageRow[]> = {}
  if (pipelineIds.length > 0) {
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
        inArray(pipelineStage.pipelineId, pipelineIds),
        eq(pipelineStage.isArchived, false),
      ))
      .orderBy(asc(pipelineStage.displayOrder))
    for (const row of stageRows) {
      (stagesByPipeline[row.pipelineId] ??= []).push(row as StageRow)
    }
  }

  // Счётчики заявок по этапам
  let stageCountMap: Record<string, Record<string, number>> = {}
  if (jobIds.length > 0) {
    const stageCountRows = await db
      .select({
        jobId: application.jobId,
        stageId: application.currentStageId,
        count: count().as('count'),
      })
      .from(application)
      .where(and(
        eq(application.organizationId, orgId),
        inArray(application.jobId, jobIds),
      ))
      .groupBy(application.jobId, application.currentStageId)
    for (const row of stageCountRows) {
      if (!row.stageId) continue
      (stageCountMap[row.jobId] ??= {})[row.stageId] = row.count
    }
  }

  /** Root-этапы воронки с roll-up счётчиков подстатусов */
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

  // hh.ru linked-jobs (для чипа «hh» в списке)
  let hhLinkedMap: Record<string, { hhVacancyId: string, importedCount: number }> = {}
  if (jobIds.length > 0) {
    const hhRows = await db
      .select({
        jobId: hhVacancyLink.jobId,
        hhVacancyId: hhVacancyLink.hhVacancyId,
        importedCount: hhVacancyLink.importedCount,
      })
      .from(hhVacancyLink)
      .where(and(
        eq(hhVacancyLink.organizationId, orgId),
        inArray(hhVacancyLink.jobId, jobIds),
      ))
    hhLinkedMap = Object.fromEntries(hhRows.map(r => [r.jobId, { hhVacancyId: r.hhVacancyId, importedCount: r.importedCount }]))
  }

  // ─── Sprint 20.2: рекрутеры каждой вакансии (для группировки на клиенте) ───
  const recruitersMap = await getJobRecruitersMap(orgId, jobIds)

  const enrichedData = data.map((j) => ({
    ...j,
    pipelineName: j.pipeline?.name ?? null,
    pipeline: pipelineMap[j.id] ?? { new: 0, screening: 0, interview: 0, offer: 0, hired: 0, rejected: 0 },
    stages: buildJobStages(j.pipelineId, j.id), // Sprint 10: динамические этапы с ролл-ап счётчиками
    hhLinked: !!hhLinkedMap[j.id],
    hhVacancyId: hhLinkedMap[j.id]?.hhVacancyId ?? null,
    hhImportedCount: hhLinkedMap[j.id]?.importedCount ?? 0,
    recruiters: recruitersMap[j.id] ?? [],
  }))

  return { data: enrichedData, total, page: query.page, limit: query.limit, scope: scope.scoped ? 'mine' : 'all' }
})
