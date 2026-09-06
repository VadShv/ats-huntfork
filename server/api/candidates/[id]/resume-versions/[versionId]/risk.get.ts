import { and, eq } from 'drizzle-orm'
import { candidate, candidateResumeVersion, resumeRisk } from '../../../../../database/schema'
import { versionRiskParamSchema } from '../../../../../utils/schemas/risk'

/**
 * GET /api/candidates/:id/resume-versions/:versionId/risk
 *
 * Risk profile for a specific resume version (ResumePanel «Риски» view — history
 * across versions). `null` when that version was never assessed.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { candidate: ['read'] })
  const orgId = session.session.activeOrganizationId

  const { id, versionId } = await getValidatedRouterParams(event, versionRiskParamSchema.parse)

  // Ensure candidate ∈ org and version ∈ candidate.
  const candidateRow = await db.query.candidate.findFirst({
    where: and(eq(candidate.id, id), eq(candidate.organizationId, orgId)),
    columns: { id: true },
  })
  if (!candidateRow) {
    throw createError({ statusCode: 404, statusMessage: 'Кандидат не найден' })
  }

  const version = await db.query.candidateResumeVersion.findFirst({
    where: and(eq(candidateResumeVersion.id, versionId), eq(candidateResumeVersion.candidateId, id)),
    columns: { id: true, contentHash: true },
  })
  if (!version) {
    throw createError({ statusCode: 404, statusMessage: 'Версия резюме не найдена' })
  }

  const risk = await db.query.resumeRisk.findFirst({
    where: and(eq(resumeRisk.resumeVersionId, versionId), eq(resumeRisk.organizationId, orgId)),
  })

  return {
    candidateId: id,
    resumeVersionId: versionId,
    stale: Boolean(risk && risk.contentHash && risk.contentHash !== version.contentHash),
    risk: risk ?? null,
  }
})
