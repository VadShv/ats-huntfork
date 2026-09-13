import { and, eq } from 'drizzle-orm'
import { candidate } from '../../../../database/schema'
import { candidateIdParamSchema } from '../../../../utils/schemas/candidate'
import { getActorContext } from '../../../../utils/access/actorContext'
import { requireCandidateInScope } from '../../../../utils/access/scope'
import { canReadContacts } from '../../../../utils/access/mask'
import { recordActivity } from '../../../../utils/recordActivity'

/**
 * GET /api/candidates/:id/hh-resume/raw
 *
 * Отдаёт сырой JSON-payload резюме с hh.ru как файл для скачивания.
 * Хедер Content-Disposition: attachment — браузер сразу сохраняет.
 *
 * Это «архивный» вариант резюме: даже если кандидат удалит резюме на hh.ru,
 * у нас останется снепшот в БД.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { candidate: ['read'] })
  const orgId = session.session.activeOrganizationId

  const { id } = await getValidatedRouterParams(event, candidateIdParamSchema.parse)

  // §B: scope guard + contacts gate (raw resume = full PII download).
  await requireCandidateInScope(event, id)
  if (!canReadContacts(await getActorContext(event))) {
    throw createError({ statusCode: 403, statusMessage: 'Нет доступа: резюме содержит контакты' })
  }

  const row = await db.query.candidate.findFirst({
    where: and(eq(candidate.id, id), eq(candidate.organizationId, orgId)),
    columns: { firstName: true, lastName: true, hhResumeId: true, hhResumeRaw: true },
  })

  if (!row) throw createError({ statusCode: 404, statusMessage: 'Кандидат не найден' })
  if (!row.hhResumeRaw) throw createError({ statusCode: 404, statusMessage: 'Нет снимка резюме из hh.ru' })

  // §7.4: raw resume download is a PII export → audit.
  recordActivity({
    organizationId: orgId,
    actorId: session.user.id,
    action: 'resume_downloaded',
    resourceType: 'candidate',
    resourceId: id,
    riskLevel: 1,
    fieldSet: 'contacts',
  })

  const safeName = `${row.lastName}-${row.firstName}-hh-${row.hhResumeId ?? 'resume'}`
    .replace(/[^a-zA-Zа-яА-Я0-9_\-]+/gu, '_')

  setResponseHeader(event, 'Content-Type', 'application/json; charset=utf-8')
  setResponseHeader(event, 'Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(safeName)}.json`)
  return row.hhResumeRaw
})
