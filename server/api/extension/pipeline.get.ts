/**
 * GET /api/extension/pipeline?jobId=...
 *
 * П2 Sidekick: read-only канбан воронки вакансии для панели расширения.
 * Канонические названия этапов приходят С СЕРВЕРА (снапшот вакансии или
 * живая воронка) — расширение не держит локальных констант этапов.
 *
 * Группировка — по корневым видимым этапам, дочерние подэтапы схлопываются
 * в родителя (та же логика, что на дашборде ATS).
 *
 * Ответ: {
 *   ok, job: { id, title, status }, source: 'snapshot'|'live'|'none',
 *   stages: [{ id, name, color, type, bucket, displayOrder, count,
 *              candidates: [{ applicationId, candidateId, name, stageChangedAt }] }]
 * }
 */
import { and, asc, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { application, candidate, job, pipelineStage } from '../../database/schema'
import { createRateLimiter } from '../../utils/rateLimit'

const limiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 60,
  message: 'Слишком много запросов. Подождите немного',
})

const querySchema = z.object({
  jobId: z.string().min(1).max(64),
})

/** Максимум карточек кандидатов на колонку (счётчик всегда полный). */
const CANDIDATES_PER_STAGE = 30

interface StageRow {
  id: string
  name: string
  color: string
  type: string
  bucket: 'working' | 'rejected'
  displayOrder: number
  isHidden: boolean
  parentStageId: string | null
}

export default defineEventHandler(async (event) => {
  await limiter(event)
  const session = await requirePermission(event, { application: ['read'] })
  const orgId = session.session.activeOrganizationId
  const query = await getValidatedQuery(event, querySchema.parse)

  const existingJob = await db.query.job.findFirst({
    where: and(eq(job.id, query.jobId), eq(job.organizationId, orgId)),
    columns: { id: true, title: true, status: true, pipelineId: true, pipelineSnapshotJson: true },
  })
  if (!existingJob) {
    throw createError({ statusCode: 404, statusMessage: 'Вакансия не найдена' })
  }

  // ─── 1. Этапы: снапшот вакансии либо живая воронка (как в pipeline-view) ───
  let source: 'snapshot' | 'live' | 'none' = 'none'
  let stageRows: StageRow[] = []

  if (existingJob.pipelineSnapshotJson) {
    const snap = existingJob.pipelineSnapshotJson as { stages: StageRow[] }
    source = 'snapshot'
    stageRows = [...(snap.stages ?? [])].sort((a, b) => a.displayOrder - b.displayOrder)
  }
  else if (existingJob.pipelineId) {
    source = 'live'
    stageRows = await db
      .select({
        id: pipelineStage.id,
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
        eq(pipelineStage.pipelineId, existingJob.pipelineId),
        eq(pipelineStage.organizationId, orgId),
        eq(pipelineStage.isArchived, false),
      ))
      .orderBy(asc(pipelineStage.displayOrder))
  }

  const roots = stageRows.filter(s => !s.parentStageId && !s.isHidden)
  // Дочерний этап → корневой (для схлопывания подэтапов)
  const stageToRoot: Record<string, string> = {}
  for (const root of roots) stageToRoot[root.id] = root.id
  for (const s of stageRows) {
    if (s.parentStageId && stageToRoot[s.parentStageId]) stageToRoot[s.id] = s.parentStageId
  }

  // ─── 2. Отклики вакансии с именами кандидатов ───
  const appRows = await db
    .select({
      applicationId: application.id,
      candidateId: application.candidateId,
      currentStageId: application.currentStageId,
      stageChangedAt: application.stageChangedAt,
      firstName: candidate.firstName,
      lastName: candidate.lastName,
      displayName: candidate.displayName,
    })
    .from(application)
    .innerJoin(candidate, eq(application.candidateId, candidate.id))
    .where(and(
      eq(application.jobId, existingJob.id),
      eq(application.organizationId, orgId),
    ))
    .orderBy(desc(application.updatedAt))
    .limit(1000)

  const byRoot: Record<string, { count: number, candidates: Array<{
    applicationId: string
    candidateId: string
    name: string
    stageChangedAt: Date | null
  }> }> = {}
  for (const root of roots) byRoot[root.id] = { count: 0, candidates: [] }

  for (const row of appRows) {
    if (!row.currentStageId) continue
    const rootId = stageToRoot[row.currentStageId]
    if (!rootId || !byRoot[rootId]) continue
    const bucket = byRoot[rootId]!
    bucket.count += 1
    if (bucket.candidates.length < CANDIDATES_PER_STAGE) {
      bucket.candidates.push({
        applicationId: row.applicationId,
        candidateId: row.candidateId,
        name: row.displayName?.trim()
          || [row.lastName, row.firstName].filter(Boolean).join(' ').trim()
          || 'Без имени',
        stageChangedAt: row.stageChangedAt,
      })
    }
  }

  logApiRequest(event, session, 'extension.pipeline', { jobId: existingJob.id, stages: roots.length })

  return {
    ok: true,
    source,
    job: { id: existingJob.id, title: existingJob.title, status: existingJob.status },
    stages: roots.map(root => ({
      id: root.id,
      name: root.name,
      color: root.color,
      type: root.type,
      bucket: root.bucket,
      displayOrder: root.displayOrder,
      count: byRoot[root.id]!.count,
      candidates: byRoot[root.id]!.candidates,
    })),
  }
})
