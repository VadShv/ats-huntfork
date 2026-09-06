import { and, eq, desc } from 'drizzle-orm'
import { candidate, candidateResumeVersion, resumeRisk } from '../../../database/schema'
import { candidateIdParamSchema } from '../../../utils/schemas/risk'

/**
 * GET /api/candidates/:id/risk-profile
 *
 * Returns the risk profile of the candidate's CURRENT resume version (glance card
 * under the AI summary). `null` when there is no current version yet. The risk row
 * may be null (never assessed) or present with status running/completed/failed.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { candidate: ['read'] })
  const orgId = session.session.activeOrganizationId

  const { id } = await getValidatedRouterParams(event, candidateIdParamSchema.parse)

  const candidateRow = await db.query.candidate.findFirst({
    where: and(eq(candidate.id, id), eq(candidate.organizationId, orgId)),
    columns: { id: true },
  })
  if (!candidateRow) {
    throw createError({ statusCode: 404, statusMessage: 'Кандидат не найден' })
  }

  // Current resume version (fallback to latest if none flagged current).
  const current = await db.query.candidateResumeVersion.findFirst({
    where: and(eq(candidateResumeVersion.candidateId, id), eq(candidateResumeVersion.isCurrent, true)),
    columns: { id: true, contentHash: true },
  })
  const version = current ?? await db.query.candidateResumeVersion.findFirst({
    where: eq(candidateResumeVersion.candidateId, id),
    orderBy: [desc(candidateResumeVersion.versionNumber)],
    columns: { id: true, contentHash: true },
  })

  if (!version) {
    return { candidateId: id, resumeVersionId: null, risk: null, stale: false }
  }

  const risk = await db.query.resumeRisk.findFirst({
    where: and(eq(resumeRisk.resumeVersionId, version.id), eq(resumeRisk.organizationId, orgId)),
  })

  return {
    candidateId: id,
    resumeVersionId: version.id,
    // Risk exists but was computed on an older content hash → outdated.
    stale: Boolean(risk && risk.contentHash && risk.contentHash !== version.contentHash),
    risk: risk ?? null,
  }
})
