import { and, desc, eq } from 'drizzle-orm'
import { candidate, candidateResumeVersion } from '../../../../database/schema'
import { candidateIdParamSchema } from '../../../../utils/schemas/candidate'
import { formatResumeDeltaRu, type ResumeDelta } from '../../../../utils/resume-version/delta'

/**
 * GET /api/candidates/:id/resume-versions
 *
 * Возвращает список всех версий резюме кандидата (desc по version_number).
 * Для UI-селектора: id, номер, дата, источник, краткая дельта (human-readable).
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { candidate: ['read'] })
  const orgId = session.session.activeOrganizationId

  const { id } = await getValidatedRouterParams(event, candidateIdParamSchema.parse)

  // Сначала проверяем, что кандидат принадлежит активной организации
  const candidateRow = await db.query.candidate.findFirst({
    where: and(eq(candidate.id, id), eq(candidate.organizationId, orgId)),
    columns: { id: true },
  })
  if (!candidateRow) {
    throw createError({ statusCode: 404, statusMessage: 'Candidate not found' })
  }

  const rows = await db
    .select({
      id: candidateResumeVersion.id,
      versionNumber: candidateResumeVersion.versionNumber,
      source: candidateResumeVersion.source,
      contentHash: candidateResumeVersion.contentHash,
      deltaSummary: candidateResumeVersion.deltaSummary,
      hhUpdatedAt: candidateResumeVersion.hhUpdatedAt,
      fetchedAt: candidateResumeVersion.fetchedAt,
      isCurrent: candidateResumeVersion.isCurrent,
      triggeredBy: candidateResumeVersion.triggeredBy,
      mergedFromCandidateId: candidateResumeVersion.mergedFromCandidateId,
      createdAt: candidateResumeVersion.createdAt,
    })
    .from(candidateResumeVersion)
    .where(eq(candidateResumeVersion.candidateId, id))
    .orderBy(desc(candidateResumeVersion.versionNumber))

  return {
    candidateId: id,
    total: rows.length,
    versions: rows.map(r => ({
      ...r,
      deltaSummaryText: formatResumeDeltaRu(r.deltaSummary as ResumeDelta),
    })),
  }
})
