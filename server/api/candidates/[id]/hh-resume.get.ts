import { and, eq } from 'drizzle-orm'
import { candidate } from '../../../database/schema'
import { candidateIdParamSchema } from '../../../utils/schemas/candidate'
import { parseHhResume } from '../../../utils/hh/resume-render'
import { getActorContext } from '../../../utils/access/actorContext'
import { requireCandidateInScope } from '../../../utils/access/scope'
import { canReadContacts } from '../../../utils/access/mask'

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

  // §B: scope guard (out-of-scope → 404) + contacts gate (resume contains PII).
  await requireCandidateInScope(event, id)
  if (!canReadContacts(await getActorContext(event))) {
    throw createError({ statusCode: 403, statusMessage: 'Нет доступа: резюме содержит контакты' })
  }

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
    throw createError({ statusCode: 404, statusMessage: 'Нет сохранённого структурированного резюме кандидата' })
  }

  const parsed = parseHhResume(row.hhResumeRaw as Record<string, unknown>)

  // Единообразие резюме: источник структуры — hh или разбор загруженного файла.
  const source = (row.hhResumeRaw as { _hf?: { source?: string } })._hf?.source === 'document_parse'
    ? 'document' as const
    : 'hh' as const

  return {
    candidateId: row.id,
    hhResumeId: row.hhResumeId,
    fetchedAt: row.hhResumeFetchedAt,
    source,
    resume: parsed,
  }
})
