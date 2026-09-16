/**
 * GET /api/hh/negotiations?vacancyLinkId=&page=0&perPage=20
 *
 * Список импортированных откликов hh.ru для конкретной связки вакансии.
 * Каждый item содержит данные из hh_negotiation + статус заявки и имя кандидата
 * через LEFT JOIN application / candidate.
 */
import { and, count, desc, eq } from 'drizzle-orm'
import { application, candidate, hhNegotiation, hhVacancyLink } from '../../../database/schema'

export default defineEventHandler(async (event) => {
  const { session } = await requirePermission(event, { hhNegotiation: ['read'] })
  const orgId = session.activeOrganizationId

  const query = getQuery(event)
  const vacancyLinkId = query.vacancyLinkId as string | undefined
  const page = Math.max(0, Number(query.page ?? 0))
  const perPage = Math.min(100, Math.max(1, Number(query.perPage ?? 20)))

  if (!vacancyLinkId) {
    throw createError({ statusCode: 400, statusMessage: 'vacancyLinkId обязателен' })
  }

  // Проверяем что link принадлежит этой организации
  const linkRows = await db
    .select({ id: hhVacancyLink.id })
    .from(hhVacancyLink)
    .where(and(
      eq(hhVacancyLink.id, vacancyLinkId),
      eq(hhVacancyLink.organizationId, orgId),
    ))
    .limit(1)
  if (linkRows.length === 0) {
    throw createError({ statusCode: 404, statusMessage: 'Связь с hh.ru не найдена' })
  }

  const whereClause = and(
    eq(hhNegotiation.hhVacancyLinkId, vacancyLinkId),
    eq(hhNegotiation.organizationId, orgId),
  )

  const [items, totalRows] = await Promise.all([
    db
      .select({
        id: hhNegotiation.id,
        hhNegotiationId: hhNegotiation.hhNegotiationId,
        hhCollection: hhNegotiation.hhCollection,
        hhState: hhNegotiation.hhState,
        hhCreatedAt: hhNegotiation.hhCreatedAt,
        applicationId: hhNegotiation.applicationId,
        candidateName: candidate.displayName,
        candidateFirstName: candidate.firstName,
        candidateLastName: candidate.lastName,
        applicationStatus: application.status,
      })
      .from(hhNegotiation)
      .leftJoin(application, eq(application.id, hhNegotiation.applicationId))
      .leftJoin(candidate, eq(candidate.id, application.candidateId))
      .where(whereClause)
      .orderBy(desc(hhNegotiation.hhCreatedAt))
      .limit(perPage)
      .offset(page * perPage),
    db
      .select({ cnt: count().as('count') })
      .from(hhNegotiation)
      .where(whereClause),
  ])

  const total = totalRows[0]?.cnt ?? 0

  return {
    items: items.map((row) => ({
      id: row.id,
      hhNegotiationId: row.hhNegotiationId,
      hhCollection: row.hhCollection,
      hhState: row.hhState,
      hhCreatedAt: row.hhCreatedAt,
      applicationId: row.applicationId,
      candidateName: row.candidateName
        ?? [row.candidateFirstName, row.candidateLastName].filter(Boolean).join(' ')
        ?? null,
      applicationStatus: row.applicationStatus,
    })),
    total,
    page,
    perPage,
  }
})
