import { and, desc, eq, or } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { candidate, candidateDuplicateCandidate } from '../../../database/schema'
import { candidateIdParamSchema } from '../../../utils/schemas/candidate'

/**
 * GET /api/candidates/:id/fuzzy-duplicates
 *
 * Возвращает список pending fuzzy-дублей конкретного кандидата.
 * Используется для баннера «Возможные дубли: N» в карточке кандидата.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { candidate: ['read'] })
  const orgId = session.session.activeOrganizationId
  const { id } = await getValidatedRouterParams(event, candidateIdParamSchema.parse)

  // Проверяем, что кандидат принадлежит активной организации
  const me = await db.query.candidate.findFirst({
    where: and(eq(candidate.id, id), eq(candidate.organizationId, orgId)),
    columns: { id: true },
  })
  if (!me) {
    throw createError({ statusCode: 404, statusMessage: 'Кандидат не найден' })
  }

  // Берём пары, где кандидат — либо A, либо B, статус pending.
  const candA = alias(candidate, 'candA')
  const candB = alias(candidate, 'candB')

  const rows = await db
    .select({
      id: candidateDuplicateCandidate.id,
      score: candidateDuplicateCandidate.score,
      signals: candidateDuplicateCandidate.signals,
      status: candidateDuplicateCandidate.status,
      createdAt: candidateDuplicateCandidate.createdAt,
      candidateAId: candidateDuplicateCandidate.candidateIdA,
      candidateBId: candidateDuplicateCandidate.candidateIdB,
      aFirstName: candA.firstName,
      aLastName: candA.lastName,
      aEmail: candA.email,
      bFirstName: candB.firstName,
      bLastName: candB.lastName,
      bEmail: candB.email,
    })
    .from(candidateDuplicateCandidate)
    .innerJoin(candA, eq(candA.id, candidateDuplicateCandidate.candidateIdA))
    .innerJoin(candB, eq(candB.id, candidateDuplicateCandidate.candidateIdB))
    .where(and(
      eq(candidateDuplicateCandidate.status, 'pending'),
      or(
        eq(candidateDuplicateCandidate.candidateIdA, id),
        eq(candidateDuplicateCandidate.candidateIdB, id),
      )!,
    ))
    .orderBy(desc(candidateDuplicateCandidate.score))

  // Для UI важно показать «другого» кандидата в паре, а не себя.
  const items = rows.map((r) => {
    const isA = r.candidateAId === id
    const otherId = isA ? r.candidateBId : r.candidateAId
    const otherFirstName = isA ? r.bFirstName : r.aFirstName
    const otherLastName = isA ? r.bLastName : r.aLastName
    const otherEmail = isA ? r.bEmail : r.aEmail
    return {
      pairId: r.id,
      score: r.score,
      signals: r.signals,
      status: r.status,
      createdAt: r.createdAt,
      other: {
        id: otherId,
        firstName: otherFirstName,
        lastName: otherLastName,
        email: otherEmail,
      },
    }
  })

  return {
    candidateId: id,
    total: items.length,
    items,
  }
})
