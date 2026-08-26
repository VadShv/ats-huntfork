import { eq, and, isNull } from 'drizzle-orm'
import { job, pipeline, application } from '../../database/schema'
import { idParamSchema, updateJobSchema, JOB_STATUS_TRANSITIONS } from '../../utils/schemas/job'
import { countActiveApplicationsForJob } from '../../utils/pipeline-helpers'

export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { job: ['update'] })
  const orgId = session.session.activeOrganizationId

  const { id } = await getValidatedRouterParams(event, idParamSchema.parse)
  const body = await readValidatedBody(event, updateJobSchema.parse)

  // Fetch existing job — needed for status transition check, slug regeneration, and pipeline change check
  const existing = await db.query.job.findFirst({
    where: and(eq(job.id, id), eq(job.organizationId, orgId)),
    columns: { status: true, title: true, slug: true, pipelineId: true },
  })

  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Вакансия не найдена' })
  }

  // Validate status transition if status is being changed
  if (body.status) {
    const allowed = JOB_STATUS_TRANSITIONS[existing.status] ?? []
    if (!allowed.includes(body.status)) {
      throw createError({
        statusCode: 422,
        statusMessage: `Нельзя изменить статус с «${existing.status}» на «${body.status}»`,
      })
    }
  }

  // ─────────────────────────────────────────────
  // Pipeline change validation
  // ─────────────────────────────────────────────

  const pipelineIsChanging =
    'pipelineId' in body &&
    body.pipelineId !== undefined &&
    body.pipelineId !== existing.pipelineId

  if (pipelineIsChanging && body.pipelineId !== null) {
    // Validate the new pipeline exists in the same org and is not archived
    const targetPipeline = await db.query.pipeline.findFirst({
      where: and(
        eq(pipeline.id, body.pipelineId!),
        eq(pipeline.organizationId, orgId),
        eq(pipeline.isArchived, false),
      ),
      columns: { id: true },
    })

    if (!targetPipeline) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Указанная воронка не найдена',
      })
    }
  }

  if (pipelineIsChanging) {
    // Block the change if there are active applications on this job
    const activeCount = await countActiveApplicationsForJob(db, id)

    if (activeCount > 0) {
      throw createError({
        statusCode: 400,
        statusMessage: `Нельзя сменить воронку: у вакансии ${activeCount} активных кандидатов. Закройте или перенесите их перед сменой воронки.`,
      })
    }

    // Clear currentStageId on any closed (terminal) applications so they don't reference
    // stages from the old pipeline. Closed apps have status hired/rejected.
    await db.update(application)
      .set({ currentStageId: null, updatedAt: new Date() })
      .where(
        and(
          eq(application.jobId, id),
          eq(application.organizationId, orgId),
        ),
      )
  }

  // Regenerate slug when title or custom slug changes
  const updates: Record<string, unknown> = { ...body, updatedAt: new Date() }
  delete (updates as any).slug // remove raw slug from spread — we set it explicitly below
  if (body.title || body.slug) {
    updates.slug = generateJobSlug(body.title ?? existing.title, id, body.slug)
  }

  const [updated] = await db.update(job)
    .set(updates)
    .where(and(eq(job.id, id), eq(job.organizationId, orgId)))
    .returning({
      id: job.id,
      title: job.title,
      slug: job.slug,
      description: job.description,
      location: job.location,
      type: job.type,
      status: job.status,
      salaryMin: job.salaryMin,
      salaryMax: job.salaryMax,
      salaryCurrency: job.salaryCurrency,
      salaryUnit: job.salaryUnit,
      salaryNegotiable: job.salaryNegotiable,
      remoteStatus: job.remoteStatus,
      validThrough: job.validThrough,
      requireResume: job.requireResume,
      requireCoverLetter: job.requireCoverLetter,
      autoScoreOnApply: job.autoScoreOnApply,
      autoRejectEnabled: job.autoRejectEnabled,
      autoRejectBelowScore: job.autoRejectBelowScore,
      autoRejectReasonNote: job.autoRejectReasonNote,
      autoAdvanceEnabled: job.autoAdvanceEnabled,
      autoAdvanceAboveScore: job.autoAdvanceAboveScore,
      autoAdvanceReasonNote: job.autoAdvanceReasonNote,
      experienceLevel: job.experienceLevel,
      pipelineId: job.pipelineId,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    })

  if (!updated) {
    throw createError({ statusCode: 404, statusMessage: 'Вакансия не найдена' })
  }

  recordActivity({
    organizationId: orgId,
    actorId: session.user.id,
    action: body.status && body.status !== existing.status ? 'status_changed' : 'updated',
    resourceType: 'job',
    resourceId: id,
    metadata: body.status && body.status !== existing.status
      ? { from: existing.status, to: body.status }
      : { title: updated.title },
  })

  if (body.status && body.status !== existing.status) {
    trackEvent(event, session, 'job status_changed', {
      job_id: id,
      from_status: existing.status,
      to_status: body.status,
    })

    logApiRequest(event, session, 'job.status_changed', {
      job_id: id,
      from_status: existing.status,
      to_status: body.status,
    })
  }

  return updated
})
