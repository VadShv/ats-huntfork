import { eq, and } from 'drizzle-orm'
import { requireJobInScope } from '../../../../utils/access/scope'
import { job, jobBrief } from '../../../../database/schema'
import { jobIdParamSchema, upsertBriefSchema } from '../../../../utils/schemas/jobBrief'

/**
 * PUT /api/jobs/:id/brief
 *
 * Upsert the job brief (internal — never exposed via the public job endpoint).
 * Requires job:update, so hiring managers (read-only) cannot edit.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { job: ['update'] })
  const orgId = session.session.activeOrganizationId

  const { id: jobId } = await getValidatedRouterParams(event, jobIdParamSchema.parse)
  await requireJobInScope(event, jobId as string)
  const body = await readValidatedBody(event, upsertBriefSchema.parse)

  // Verify the job belongs to the org
  const existingJob = await db.query.job.findFirst({
    where: and(eq(job.id, jobId), eq(job.organizationId, orgId)),
    columns: { id: true },
  })
  if (!existingJob) {
    throw createError({ statusCode: 404, statusMessage: 'Вакансия не найдена' })
  }

  const now = new Date()
  // Normalize: undefined → leave as default on insert; null → clear on update.
  const values = {
    hardMustHave: body.hardMustHave ?? [],
    niceToHave: body.niceToHave ?? [],
    dealBreakers: body.dealBreakers ?? [],
    redFlagsToWatch: body.redFlagsToWatch ?? [],
    responsibilities: body.responsibilities ?? null,
    teamContext: body.teamContext ?? null,
    interviewProcess: body.interviewProcess ?? null,
    compensationNotes: body.compensationNotes ?? null,
    idealProfile: body.idealProfile ?? null,
    sourcingHints: body.sourcingHints ?? null,
    freeform: body.freeform ?? null,
  }

  const existing = await db.query.jobBrief.findFirst({
    where: and(eq(jobBrief.jobId, jobId), eq(jobBrief.organizationId, orgId)),
    columns: { id: true },
  })

  let saved
  if (existing) {
    ;[saved] = await db.update(jobBrief)
      .set({ ...values, filledById: session.user.id, filledAt: now, updatedAt: now })
      .where(and(eq(jobBrief.id, existing.id), eq(jobBrief.organizationId, orgId)))
      .returning()
  }
  else {
    ;[saved] = await db.insert(jobBrief)
      .values({ organizationId: orgId, jobId, ...values, filledById: session.user.id, filledAt: now })
      .returning()
  }

  recordActivity({
    organizationId: orgId,
    actorId: session.user.id,
    action: 'updated',
    resourceType: 'job',
    resourceId: jobId,
    metadata: { section: 'brief' },
  })

  return saved
})
