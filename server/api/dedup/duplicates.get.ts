import { and, asc, desc, eq, gte, inArray, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { alias } from 'drizzle-orm/pg-core'
import { application, candidate, candidateDuplicateCandidate, organizationExt } from '../../database/schema'
import { getOrgGroupId } from '../../utils/dedup/resolve'

const querySchema = z.object({
  status: z.enum(['pending', 'dismissed', 'merged']).default('pending'),
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
  /** Минимальный скор для фильтра (по умолчанию — все, начиная с порога 85). */
  minScore: z.coerce.number().int().min(0).max(100).optional(),
  /** Включать пары из всех организаций группы. */
  includeOtherOrgs: z.coerce.boolean().default(true),
  /** Sprint 4.3 (P3.3): сортировка очереди */
  sort: z.enum(['score_desc', 'score_asc', 'newest', 'oldest', 'fraud_first', 'active_apps_desc']).default('score_desc'),
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

  // Sprint 4.3 (P3.3): подзапросы для счётчика активных заявок (не hired/rejected) по каждому кандидату
  const activeAppsA = sql<number>`(
    SELECT count(*)::int FROM ${application}
    WHERE ${application.candidateId} = ${candA.id}
      AND ${application.status} NOT IN ('hired','rejected')
  )`
  const activeAppsB = sql<number>`(
    SELECT count(*)::int FROM ${application}
    WHERE ${application.candidateId} = ${candB.id}
      AND ${application.status} NOT IN ('hired','rejected')
  )`

  // Sprint 4.3 (P3.3): выбор сортировки
  const orderBy = (() => {
    switch (query.sort) {
      case 'score_asc':
        return [asc(candidateDuplicateCandidate.score), desc(candidateDuplicateCandidate.createdAt)]
      case 'newest':
        return [desc(candidateDuplicateCandidate.createdAt)]
      case 'oldest':
        return [asc(candidateDuplicateCandidate.createdAt)]
      case 'fraud_first':
        // фродовые (хотя бы у одного fraud_flag=true) вперёд
        return [
          desc(sql`(${candA.fraudFlag} OR ${candB.fraudFlag})`),
          desc(candidateDuplicateCandidate.score),
          desc(candidateDuplicateCandidate.createdAt),
        ]
      case 'active_apps_desc':
        return [
          desc(sql`${activeAppsA} + ${activeAppsB}`),
          desc(candidateDuplicateCandidate.score),
          desc(candidateDuplicateCandidate.createdAt),
        ]
      case 'score_desc':
      default:
        return [desc(candidateDuplicateCandidate.score), desc(candidateDuplicateCandidate.createdAt)]
    }
  })()

  const rows = await db
    .select({
      id: candidateDuplicateCandidate.id,
      score: candidateDuplicateCandidate.score,
      signals: candidateDuplicateCandidate.signals,
      status: candidateDuplicateCandidate.status,
      createdAt: candidateDuplicateCandidate.createdAt,
      // Sprint 5.2 (P5.2): AI-арбитр
      aiVerdict: candidateDuplicateCandidate.aiVerdict,
      aiConfidence: candidateDuplicateCandidate.aiConfidence,
      aiReasoning: candidateDuplicateCandidate.aiReasoning,
      aiCheckedAt: candidateDuplicateCandidate.aiCheckedAt,
      candidateAId: candA.id,
      candidateAFirstName: candA.firstName,
      candidateALastName: candA.lastName,
      candidateAEmail: candA.email,
      candidateAPhone: candA.phone,
      candidateADateOfBirth: candA.dateOfBirth,
      candidateACity: candA.city,
      candidateALinkedin: candA.linkedin,
      candidateATelegram: candA.telegram,
      candidateAGithub: candA.github,
      candidateAOrgId: candA.organizationId,
      candidateAFraudFlag: candA.fraudFlag,
      candidateAActiveApps: activeAppsA,
      candidateBId: candB.id,
      candidateBFirstName: candB.firstName,
      candidateBLastName: candB.lastName,
      candidateBEmail: candB.email,
      candidateBPhone: candB.phone,
      candidateBDateOfBirth: candB.dateOfBirth,
      candidateBCity: candB.city,
      candidateBLinkedin: candB.linkedin,
      candidateBTelegram: candB.telegram,
      candidateBGithub: candB.github,
      candidateBOrgId: candB.organizationId,
      candidateBFraudFlag: candB.fraudFlag,
      candidateBActiveApps: activeAppsB,
    })
    .from(candidateDuplicateCandidate)
    .innerJoin(candA, eq(candA.id, candidateDuplicateCandidate.candidateIdA))
    .innerJoin(candB, eq(candB.id, candidateDuplicateCandidate.candidateIdB))
    .where(and(...whereConds))
    .orderBy(...orderBy)
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
      aiVerdict: r.aiVerdict,
      aiConfidence: r.aiConfidence,
      aiReasoning: r.aiReasoning,
      aiCheckedAt: r.aiCheckedAt,
      candidateA: {
        id: r.candidateAId,
        firstName: r.candidateAFirstName,
        lastName: r.candidateALastName,
        email: r.candidateAEmail,
        phone: r.candidateAPhone,
        dateOfBirth: r.candidateADateOfBirth,
        city: r.candidateACity,
        linkedin: r.candidateALinkedin,
        telegram: r.candidateATelegram,
        github: r.candidateAGithub,
        organizationId: r.candidateAOrgId,
        fraudFlag: r.candidateAFraudFlag,
        activeApplications: r.candidateAActiveApps ?? 0,
      },
      candidateB: {
        id: r.candidateBId,
        firstName: r.candidateBFirstName,
        lastName: r.candidateBLastName,
        email: r.candidateBEmail,
        phone: r.candidateBPhone,
        dateOfBirth: r.candidateBDateOfBirth,
        city: r.candidateBCity,
        linkedin: r.candidateBLinkedin,
        telegram: r.candidateBTelegram,
        github: r.candidateBGithub,
        organizationId: r.candidateBOrgId,
        fraudFlag: r.candidateBFraudFlag,
        activeApplications: r.candidateBActiveApps ?? 0,
      },
    })),
  }
})
