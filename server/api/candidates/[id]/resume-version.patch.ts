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
      delete updatedRaw.salary
    }
    else {
      updatedRaw.salary = {
        amount: body.salary.amount,
        currency: body.salary.currency || 'RUR',
      }
    }
  }

  // ── Header fields ──
  if (body.firstName !== undefined) updatedRaw.first_name = body.firstName || undefined
  if (body.lastName !== undefined) updatedRaw.last_name = body.lastName || undefined
  if (body.middleName !== undefined) updatedRaw.middle_name = body.middleName || undefined
  if (body.title !== undefined) updatedRaw.title = body.title || undefined
  if (body.area !== undefined) {
    if (body.area) updatedRaw.area = { name: body.area }
    else delete updatedRaw.area
  }

  // ── Education: replace education.primary array ──
  if (body.education !== undefined) {
    updatedRaw.education = {
      primary: body.education.map((e) => {
        const item: Record<string, any> = {}
        if (e.organization) item.organization = e.organization
        if (e.name) item.name = e.name
        if (e.result) item.result = e.result
        if (e.year != null) item.year = e.year
        return item
      }),
    }
  }

  // ── Skills (short tags): replace skill_set array ──
  if (body.skills !== undefined) {
    updatedRaw.skill_set = body.skills.filter((s) => s.trim()).map((s) => s.trim())
  }

  // ── About (long text): replace skills field (hh stores about in `skills`) ──
  if (body.about !== undefined) {
    updatedRaw.skills = body.about || undefined
  }

  // ── Languages: replace language array ──
  if (body.languages !== undefined) {
    updatedRaw.language = body.languages
      .filter((l) => l.name?.trim())
      .map((l) => ({
        name: l.name!.trim(),
        ...(l.level?.trim() ? { level: { name: l.level.trim() } } : {}),
      }))
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
