import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { candidate, candidateResumeVersion } from '../../../../database/schema'
import { parseHhResume } from '../../../../utils/hh/resume-render'

const paramsSchema = z.object({
  id: z.string().min(1),
  versionId: z.string().min(1),
})

/**
 * GET /api/candidates/:id/resume-versions/:versionId
 *
 * Возвращает полный snapshot конкретной версии резюме (распаршенный для UI).
 * Используется когда пользователь выбирает не-текущую версию в селекторе.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { candidate: ['read'] })
  const orgId = session.session.activeOrganizationId

  const { id, versionId } = await getValidatedRouterParams(event, paramsSchema.parse)

  // Проверяем доступ к кандидату
  const candidateRow = await db.query.candidate.findFirst({
    where: and(eq(candidate.id, id), eq(candidate.organizationId, orgId)),
    columns: { id: true, firstName: true, lastName: true },
  })
  if (!candidateRow) {
    throw createError({ statusCode: 404, statusMessage: 'Кандидат не найден' })
  }

  const versionRow = await db.query.candidateResumeVersion.findFirst({
    where: and(
      eq(candidateResumeVersion.id, versionId),
      eq(candidateResumeVersion.candidateId, id),
    ),
  })
  if (!versionRow) {
    throw createError({ statusCode: 404, statusMessage: 'Версия резюме не найдена' })
  }

  const parsed = parseHhResume(versionRow.snapshot as Record<string, unknown>)

  // Единообразие с /hh-resume: top-level source ('document'|'hh') и fetchedAt,
  // которые ожидает HhResumeView для чипа источника и «обновлено N назад».
  const source = (versionRow.snapshot as { _hf?: { source?: string } })?._hf?.source === 'document_parse'
    ? 'document' as const
    : 'hh' as const

  return {
    candidateId: id,
    source,
    fetchedAt: versionRow.fetchedAt,
    version: {
      id: versionRow.id,
      versionNumber: versionRow.versionNumber,
      source: versionRow.source,
      contentHash: versionRow.contentHash,
      isCurrent: versionRow.isCurrent,
      fetchedAt: versionRow.fetchedAt,
      hhUpdatedAt: versionRow.hhUpdatedAt,
      triggeredBy: versionRow.triggeredBy,
      mergedFromCandidateId: versionRow.mergedFromCandidateId,
      deltaSummary: versionRow.deltaSummary,
    },
    resume: parsed,
    raw: versionRow.snapshot,
  }
})
