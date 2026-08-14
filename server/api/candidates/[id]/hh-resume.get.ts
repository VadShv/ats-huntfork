import { and, eq } from 'drizzle-orm'
import { candidate } from '../../../database/schema'
import { candidateIdParamSchema } from '../../../utils/schemas/candidate'
import { parseHhResume } from '../../../utils/hh/resume-render'

/**
 * GET /api/candidates/:id/hh-resume
 *
 * Возвращает структурированное резюме с hh.ru (опыт, образование, навыки и т.п.)
 * для красивого рендера в карточке. Если у кандидата нет hh-резюме — 404.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { candidate: ['read'] })
  const orgId = session.session.activeOrganizationId

  const { id } = await getValidatedRouterParams(event, candidateIdParamSchema.parse)

  const row = await db.query.candidate.findFirst({
    where: and(eq(candidate.id, id), eq(candidate.organizationId, orgId)),
    columns: {
      id: true,
      firstName: true,
      lastName: true,
      hhResumeId: true,
      hhResumeRaw: true,
      hhResumeFetchedAt: true,
    },
  })

  if (!row) throw createError({ statusCode: 404, statusMessage: 'Кандидат не найден' })
  if (!row.hhResumeRaw) {
    throw createError({ statusCode: 404, statusMessage: 'Нет снимка резюме кандидата из hh.ru' })
  }

  const parsed = parseHhResume(row.hhResumeRaw as Record<string, unknown>)

  return {
    candidateId: row.id,
    hhResumeId: row.hhResumeId,
    fetchedAt: row.hhResumeFetchedAt,
    resume: parsed,
  }
})
