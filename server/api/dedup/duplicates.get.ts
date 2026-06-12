import { and, desc, eq, gte, inArray, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { alias } from 'drizzle-orm/pg-core'
import { candidate, candidateDuplicateCandidate, organizationExt } from '../../database/schema'
import { getOrgGroupId } from '../../utils/dedup/resolve'

const querySchema = z.object({
  status: z.enum(['pending', 'dismissed', 'merged']).default('pending'),
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
  /** Минимальный скор для фильтра (по умолчанию — все, начиная с порога 85). */
  minScore: z.coerce.number().int().min(0).max(100).optional(),
  /** Включать пары из всех организаций группы. */
  includeOtherOrgs: z.coerce.boolean().default(true),
})

/**
 * GET /api/dedup/duplicates
 *
 * Возвращает очередь pending-пар fuzzy-дублей в рамках организации (или всей группы).
 * Для UI-дашборда /dashboard/candidates/duplicates (Этап 4 — пока только endpoint).
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { candidate: ['read'] })
  const orgId = session.session.activeOrganizationId
  const query = await getValidatedQuery(event, querySchema.parse)

  // Список организаций, кандидаты которых нас интересуют — либо одна, либо вся группа.
  let candidateOrgIds: string[] = [orgId]
  if (query.includeOtherOrgs) {
    const groupId = await getOrgGroupId(orgId)
    if (groupId) {
      const arr = await db
        .select({ id: organizationExt.id })
        .from(organizationExt)
        .where(eq(organizationExt.groupId, groupId))
      candidateOrgIds = arr.map(r => r.id)
      if (!candidateOrgIds.includes(orgId)) candidateOrgIds.push(orgId)
    }
  }

  // Алиасы candidate для двух join-ов: A и B.
  const candA = alias(candidate, 'candA')
  const candB = alias(candidate, 'candB')

  const whereConds = [
    eq(candidateDuplicateCandidate.status, query.status),
    or(
      inArray(candA.organizationId, candidateOrgIds),
      inArray(candB.organizationId, candidateOrgIds),
    )!,
  ]
  if (query.minScore !== undefined) {
    whereConds.push(gte(candidateDuplicateCandidate.score, query.minScore))
  }

  const rows = await db
    .select({
      id: candidateDuplicateCandidate.id,
      score: candidateDuplicateCandidate.score,
      signals: candidateDuplicateCandidate.signals,
      status: candidateDuplicateCandidate.status,
      createdAt: candidateDuplicateCandidate.createdAt,
      candidateAId: candA.id,
      candidateAFirstName: candA.firstName,
      candidateALastName: candA.lastName,
      candidateAEmail: candA.email,
      candidateAOrgId: candA.organizationId,
      candidateAFraudFlag: candA.fraudFlag,
      candidateBId: candB.id,
      candidateBFirstName: candB.firstName,
      candidateBLastName: candB.lastName,
      candidateBEmail: candB.email,
      candidateBOrgId: candB.organizationId,
      candidateBFraudFlag: candB.fraudFlag,
    })
    .from(candidateDuplicateCandidate)
    .innerJoin(candA, eq(candA.id, candidateDuplicateCandidate.candidateIdA))
    .innerJoin(candB, eq(candB.id, candidateDuplicateCandidate.candidateIdB))
    .where(and(...whereConds))
    .orderBy(desc(candidateDuplicateCandidate.score), desc(candidateDuplicateCandidate.createdAt))
    .limit(query.limit)
    .offset(query.offset)

  return {
    total: rows.length,
    limit: query.limit,
    offset: query.offset,
    items: rows.map(r => ({
      id: r.id,
      score: r.score,
      signals: r.signals,
      status: r.status,
      createdAt: r.createdAt,
      candidateA: {
        id: r.candidateAId,
        firstName: r.candidateAFirstName,
        lastName: r.candidateALastName,
        email: r.candidateAEmail,
        organizationId: r.candidateAOrgId,
        fraudFlag: r.candidateAFraudFlag,
      },
      candidateB: {
        id: r.candidateBId,
        firstName: r.candidateBFirstName,
        lastName: r.candidateBLastName,
        email: r.candidateBEmail,
        organizationId: r.candidateBOrgId,
        fraudFlag: r.candidateBFraudFlag,
      },
    })),
  }
})
