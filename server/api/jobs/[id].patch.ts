import { eq, and, isNull } from 'drizzle-orm'
import { job, company, department, jobStatusHistory } from '../../database/schema'
import { idParamSchema, updateJobSchema, JOB_STATUS_TRANSITIONS } from '../../utils/schemas/job'
import { computeJobLifecycleUpdate } from '../../utils/job-lifecycle'
import { getActorContext } from '../../utils/access/actorContext'
import { isJobInScope } from '../../utils/access/scope'

export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { job: ['update'] })
  const orgId = session.session.activeOrganizationId
  const actor = await getActorContext(event)

  const { id } = await getValidatedRouterParams(event, idParamSchema.parse)

  // Scope guard (RBAC v2 — "private jobs"): out-of-scope job → 404.
  if (actor && !(await isJobInScope(actor, id))) {
    throw createError({ statusCode: 404, statusMessage: 'Вакансия не найдена' })
  }

  const body = await readValidatedBody(event, updateJobSchema.parse)

  // Fetch existing job — needed for status transition check, slug regeneration, and pipeline change check
  const existing = await db.query.job.findFirst({
    where: and(eq(job.id, id), eq(job.organizationId, orgId)),
    columns: {
      status: true, title: true, slug: true, pipelineId: true,
      firstOpenedAt: true, reopenCount: true,
    },
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

  // B2: смена воронки у вакансии запрещена — pipelineId удалён из updateJobSchema
  // и здесь не обрабатывается. Вакансия всегда на канонической воронке.

  // Проверка принадлежности компании и подразделения организации (null — снятие привязки, разрешено)
  if (body.companyId) {
    const existingCompany = await db.query.company.findFirst({
      where: and(eq(company.id, body.companyId), eq(company.organizationId, orgId)),
      columns: { id: true },
    })
    if (!existingCompany) {
      throw createError({ statusCode: 400, statusMessage: 'Указанная компания не найдена' })
    }
  }

  if (body.departmentId) {
    const existingDepartment = await db.query.department.findFirst({
      where: and(eq(department.id, body.departmentId), eq(department.organizationId, orgId)),
      columns: { id: true },
    })
    if (!existingDepartment) {
      throw createError({ statusCode: 400, statusMessage: 'Указанное подразделение не найдено' })
    }
  }

  // Regenerate slug when title or custom slug changes
  const updates: Record<string, unknown> = { ...body, updatedAt: new Date() }
  delete (updates as any).slug // remove raw slug from spread — we set it explicitly below
  // closeReason управляется через lifecycle-логику ниже (не слепой спред):
  // записывается только при переходе в closed, иначе сохраняется прежнее значение.
  delete (updates as any).closeReason
  if (body.title || body.slug) {
    updates.slug = generateJobSlug(body.title ?? existing.title, id, body.slug)
  }

  // ─────────────────────────────────────────────
  // Lifecycle-таймстампы вакансии (Центр аналитики)
  // При смене статуса заполняем opened_at/closed_at/first_opened_at/reopen_count/
  // close_reason/filled_at и пишем строку в job_status_history — транзакционно,
  // в отличие от fire-and-forget recordActivity.
  // ─────────────────────────────────────────────
  const statusChanged = !!body.status && body.status !== existing.status
  const now = new Date()
  if (statusChanged) {
    Object.assign(updates, computeJobLifecycleUpdate(
      { status: existing.status, firstOpenedAt: existing.firstOpenedAt, reopenCount: existing.reopenCount },
      body.status,
      now,
      body.closeReason,
    ))
  }

  const [updated] = await db.transaction(async (tx) => {
    const rows = await tx.update(job)
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
      openedAt: job.openedAt,
      closedAt: job.closedAt,
      firstOpenedAt: job.firstOpenedAt,
      reopenCount: job.reopenCount,
      closeReason: job.closeReason,
      filledAt: job.filledAt,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    })

    // Append-only история статусов — в той же транзакции, что и обновление job.
    if (statusChanged && rows[0]) {
      await tx.insert(jobStatusHistory).values({
        organizationId: orgId,
        jobId: id,
        fromStatus: existing.status,
        toStatus: body.status!,
        changedByUserId: session.user.id,
        reason: body.status === 'closed' ? (body.closeReason ?? null) : null,
        changedAt: now,
      })
    }

    return rows
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
