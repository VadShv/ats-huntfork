import { and, desc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { candidateMergeLog, organization, user } from '../../database/schema'
import { buildMergesQuery } from '../../utils/dedup/merges-query'

const querySchema = z.object({
  /**
   * active   — rollback ещё возможен (rollback_until > now() и action='merge')
   * expired  — окно отката закрыто (rollback_until <= now() и action='merge')
   * rolled_back — есть запись с action='rollback' для этой пары
   * all      — всё подряд
   */
  status: z.enum(['active', 'expired', 'rolled_back', 'all']).default('active'),
  mergeKind: z.enum(['auto', 'manual', 'all']).default('all'),
  userId: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  search: z.string().optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
  includeOtherOrgs: z.coerce.boolean().default(true),
  /** Sprint 4.2 (P3.2): own | cross | all */
  orgScope: z.enum(['own', 'cross', 'all']).default('all'),
})

/**
 * GET /api/dedup/merges
 *
 * Журнал слияний кандидатов: список merge-записей с фильтрами,
 * пагинацией и JOIN на текущее состояние кандидатов и пользователя-исполнителя.
 *
 * canRollback = (action='merge' AND rollback_until > now() AND нет записи 'rollback' с той же парой).
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { candidate: ['read'] })
  const orgId = session.session.activeOrganizationId
  const query = await getValidatedQuery(event, querySchema.parse)

  const { primary, merged, whereConds, rollbackExists } = await buildMergesQuery(orgId, query)

  // Sprint 4.2 (P3.2): фильтр «только своя» / «только cross-org» — по organizationId merge_log
  if (query.orgScope === 'own') {
    whereConds.push(eq(candidateMergeLog.organizationId, orgId))
  }
  else if (query.orgScope === 'cross') {
    whereConds.push(sql`${candidateMergeLog.organizationId} <> ${orgId}`)
  }

  const totalRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(candidateMergeLog)
    .leftJoin(primary, eq(primary.id, candidateMergeLog.primaryCandidateId))
    .leftJoin(merged, eq(merged.id, candidateMergeLog.mergedCandidateId))
    .where(and(...whereConds))
  const total = totalRows[0]?.count ?? 0

  const rows = await db
    .select({
      id: candidateMergeLog.id,
      createdAt: candidateMergeLog.createdAt,
      action: candidateMergeLog.action,
      organizationId: candidateMergeLog.organizationId,
      organizationName: organization.name,
      mergeKind: candidateMergeLog.mergeKind,
      score: candidateMergeLog.score,
      reason: candidateMergeLog.reason,
      signals: candidateMergeLog.signals,
      rollbackUntil: candidateMergeLog.rollbackUntil,
      primaryCandidateId: candidateMergeLog.primaryCandidateId,
      mergedCandidateId: candidateMergeLog.mergedCandidateId,
      // primary — текущее состояние
      primaryFirstName: primary.firstName,
      primaryLastName: primary.lastName,
      primaryEmail: primary.email,
      primaryMergeStatus: primary.mergeStatus,
      primaryFraudFlag: primary.fraudFlag,
      // merged — текущее состояние (он уже merged-помечен)
      mergedFirstName: merged.firstName,
      mergedLastName: merged.lastName,
      mergedEmail: merged.email,
      mergedMergeStatus: merged.mergeStatus,
      // performer
      performerId: user.id,
      performerName: user.name,
      performerEmail: user.email,
      // rollback?
      hasRollback: rollbackExists,
      // snapshot для fallback на исторические имена (если кандидат удалён)
      snapshot: candidateMergeLog.snapshot,
    })
    .from(candidateMergeLog)
    .leftJoin(primary, eq(primary.id, candidateMergeLog.primaryCandidateId))
    .leftJoin(merged, eq(merged.id, candidateMergeLog.mergedCandidateId))
    .leftJoin(user, eq(user.id, candidateMergeLog.performedByUserId))
    .leftJoin(organization, eq(organization.id, candidateMergeLog.organizationId))
    .where(and(...whereConds))
    .orderBy(desc(candidateMergeLog.createdAt))
    .limit(query.limit)
    .offset(query.offset)

  const now = Date.now()
  const items = rows.map((r) => {
    const snap = r.snapshot as any
    // fallback на snapshot если кандидат удалён
    const primaryFirstName = r.primaryFirstName ?? snap?.primary?.firstName ?? null
    const primaryLastName = r.primaryLastName ?? snap?.primary?.lastName ?? null
    const primaryEmail = r.primaryEmail ?? snap?.primary?.email ?? null
    const mergedFirstName = r.mergedFirstName ?? snap?.merged?.firstName ?? null
    const mergedLastName = r.mergedLastName ?? snap?.merged?.lastName ?? null
    const mergedEmail = r.mergedEmail ?? snap?.merged?.email ?? null

    const rollbackUntil = r.rollbackUntil
    const daysUntilExpiry = rollbackUntil
      ? Math.max(0, Math.ceil((new Date(rollbackUntil).getTime() - now) / (1000 * 60 * 60 * 24)))
      : 0
    const canRollback = !r.hasRollback && rollbackUntil && new Date(rollbackUntil).getTime() > now

    return {
      id: r.id,
      createdAt: r.createdAt,
      action: r.action,
      organizationId: r.organizationId,
      organizationName: r.organizationName ?? null,
      /** Sprint 4.2: true если merge был в чужой организации (cross-org сценарий) */
      isCrossOrg: r.organizationId !== orgId,
      mergeKind: r.mergeKind,
      score: r.score,
      reason: r.reason,
      signals: r.signals ?? {},
      rollbackUntil,
      daysUntilExpiry,
      canRollback: Boolean(canRollback),
      isRolledBack: Boolean(r.hasRollback),
      primary: {
        id: r.primaryCandidateId,
        firstName: primaryFirstName,
        lastName: primaryLastName,
        email: primaryEmail,
        mergeStatus: r.primaryMergeStatus,
        fraudFlag: r.primaryFraudFlag ?? false,
        exists: r.primaryFirstName !== null || r.primaryLastName !== null,
      },
      merged: {
        id: r.mergedCandidateId,
        firstName: mergedFirstName,
        lastName: mergedLastName,
        email: mergedEmail,
        mergeStatus: r.mergedMergeStatus,
        exists: r.mergedFirstName !== null || r.mergedLastName !== null,
      },
      performedBy: r.performerId
        ? { id: r.performerId, name: r.performerName, email: r.performerEmail }
        : null,
    }
  })

  return { total, limit: query.limit, offset: query.offset, items }
})
