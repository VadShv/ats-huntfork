import { eq, and } from 'drizzle-orm'
import { application, candidate, job, applicationStageHistory } from '../../database/schema'
import { createApplicationSchema } from '../../utils/schemas/application'
import { getEntryStageForPipeline } from '../../utils/pipeline-helpers'
import { autoScoreApplication } from '../../utils/ai/autoScore'

/**
 * POST /api/applications
 * Create an application linking an existing candidate to a job.
 * Both candidate and job must belong to the session's organization.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { application: ['create'] })
  const orgId = session.session.activeOrganizationId

  const body = await readValidatedBody(event, createApplicationSchema.parse)

  // Verify candidate belongs to this org
  const existingCandidate = await db.query.candidate.findFirst({
    where: and(eq(candidate.id, body.candidateId), eq(candidate.organizationId, orgId)),
    columns: { id: true },
  })

  if (!existingCandidate) {
    throw createError({ statusCode: 404, statusMessage: 'Кандидат не найден' })
  }

  // Verify job belongs to this org — also fetch pipelineId for stage assignment
  const existingJob = await db.query.job.findFirst({
    where: and(eq(job.id, body.jobId), eq(job.organizationId, orgId)),
    columns: { id: true, pipelineId: true, autoScoreOnApply: true },
  })

  if (!existingJob) {
    throw createError({ statusCode: 404, statusMessage: 'Вакансия не найдена' })
  }

  // Check for duplicate application
  const existing = await db.query.application.findFirst({
    where: and(
      eq(application.organizationId, orgId),
      eq(application.candidateId, body.candidateId),
      eq(application.jobId, body.jobId),
    ),
    columns: { id: true },
  })

  if (existing) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Этот кандидат уже откликнулся на эту вакансию',
    })
  }

  // ─────────────────────────────────────────────
  // Resolve the entry stage for the job's pipeline
  // ─────────────────────────────────────────────

  let entryStageId: string | null = null
  if (existingJob.pipelineId) {
    const entryStage = await getEntryStageForPipeline(db, existingJob.pipelineId)
    entryStageId = entryStage?.id ?? null
  }

  const now = new Date()

  const [created] = await db.insert(application).values({
    organizationId: orgId,
    candidateId: body.candidateId,
    jobId: body.jobId,
    notes: body.notes,
    status: 'new',
    currentStageId: entryStageId,
    stageChangedAt: entryStageId ? now : null,
  }).returning({
    id: application.id,
    candidateId: application.candidateId,
    jobId: application.jobId,
    status: application.status,
    score: application.score,
    notes: application.notes,
    currentStageId: application.currentStageId,
    stageChangedAt: application.stageChangedAt,
    createdAt: application.createdAt,
    updatedAt: application.updatedAt,
  })

  if (!created) {
    throw createError({ statusCode: 500, statusMessage: 'Не удалось создать отклик' })
  }

  // Write initial stage history row if a pipeline entry stage was resolved
  if (entryStageId) {
    await db.insert(applicationStageHistory).values({
      organizationId: orgId,
      applicationId: created.id,
      fromStageId: null,
      toStageId: entryStageId,
      movedByUserId: session.user.id,
      movedAt: now,
    })
  }

  recordActivity({
    organizationId: orgId,
    actorId: session.user.id,
    action: 'created',
    resourceType: 'application',
    resourceId: created.id,
    metadata: { candidateId: body.candidateId, jobId: body.jobId },
  })

  // Спринт 16: автооценка при ручном добавлении на вакансию —
  // тот же fire-and-forget, что и при публичном отклике / hh-импорте.
  if (existingJob.autoScoreOnApply) {
    autoScoreApplication(created.id, orgId).catch((err) => {
      logError('application.auto_score_failed', {
        application_id: created.id,
        job_id: body.jobId,
        error_message: err instanceof Error ? err.message : String(err),
      })
    })
  }

  setResponseStatus(event, 201)
  return created
})
