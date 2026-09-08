import { and, eq } from 'drizzle-orm'
import { candidate, candidateResumeVersion } from '../../../database/schema'
import { candidateIdParamSchema, editResumeVersionSchema } from '../../../utils/schemas/resumeVersionEdit'
import { appendResumeVersionIfChanged } from '../../../utils/resume-version/append'
import { refreshCandidateSearchTsv } from '../../../utils/candidateSearchText'

/**
 * PATCH /api/candidates/:id/resume-version
 *
 * Edit the structured resume: reorder/edit/add/remove experience entries,
 * change or remove salary. Creates a new resume version (preserving history)
 * and updates candidate.hhResumeRaw so the UI reflects changes immediately.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { candidate: ['update'] })
  const orgId = session.session.activeOrganizationId

  const { id: candidateId } = await getValidatedRouterParams(event, candidateIdParamSchema.parse)
  const body = await readValidatedBody(event, editResumeVersionSchema.parse)

  // Verify candidate ∈ org.
  const cand = await db.query.candidate.findFirst({
    where: and(eq(candidate.id, candidateId), eq(candidate.organizationId, orgId)),
    columns: { id: true, hhResumeRaw: true },
  })
  if (!cand) {
    throw createError({ statusCode: 404, statusMessage: 'Кандидат не найден' })
  }

  // Current snapshot (hh-compatible raw JSON).
  const raw = (cand.hhResumeRaw ?? {}) as Record<string, any>
  const updatedRaw: Record<string, any> = { ...raw }

  // ── Experience: replace the array if provided ──
  if (body.experience !== undefined) {
    updatedRaw.experience = body.experience.map((e) => {
      const item: Record<string, any> = {}
      if (e.company) item.company = e.company
      if (e.position) item.position = e.position
      if (e.start) item.start = e.start
      if (e.end) item.end = e.end
      if (e.description) item.description = e.description
      return item
    })
  }

  // ── Salary: set, change, or remove ──
  if (body.salary !== undefined) {
    if (body.salary === null || body.salary.amount === null) {
      // Remove salary entirely.
      delete updatedRaw.salary
    }
    else {
      updatedRaw.salary = {
        amount: body.salary.amount,
        currency: body.salary.currency || 'RUR',
      }
    }
  }

  // Update candidate.hhResumeRaw (so /hh-resume reflects changes immediately).
  await db.update(candidate)
    .set({ hhResumeRaw: updatedRaw })
    .where(and(eq(candidate.id, candidateId), eq(candidate.organizationId, orgId)))

  // Create a new resume version (preserves history; bypassDebounce forces it).
  const versionResult = await appendResumeVersionIfChanged({
    candidateId,
    raw: updatedRaw,
    source: 'manual_upload',
    triggeredBy: session.user.id,
    bypassDebounce: true,
  })

  // Refresh search TSV so edited text is searchable.
  await refreshCandidateSearchTsv({ orgId, candidateId })

  recordActivity({
    organizationId: orgId,
    actorId: session.user.id,
    action: 'updated',
    resourceType: 'candidate',
    resourceId: candidateId,
    metadata: { section: 'resume_version', action: versionResult.action, versionNumber: versionResult.versionNumber },
  })

  return {
    candidateId,
    action: versionResult.action,
    versionId: versionResult.versionId,
    versionNumber: versionResult.versionNumber,
  }
})
