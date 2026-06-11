import { and, desc, eq, gte, ilike, inArray, lte, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { alias } from 'drizzle-orm/pg-core'
import { candidate, candidateMergeLog, user } from '../../database/schema'
import { getOrgGroupId } from '../../utils/dedup/resolve'

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

  // Список организаций
  let orgIds: string[] = [orgId]
  if (query.includeOtherOrgs) {
    const groupId = await getOrgGroupId(orgId)
    if (groupId) {
      const res = await db.execute<{ id: string }>(
        sql`SELECT id FROM organization WHERE group_id = ${groupId}`,
      )
      const arr: Array<{ id: string }> = Array.isArray(res) ? (res as any) : ((res as any).rows ?? [])
      orgIds = arr.map(r => r.id)
      if (!orgIds.includes(orgId)) orgIds.push(orgId)
    }
  }

  const primary = alias(candidate, 'primary')
  const merged = alias(candidate, 'merged')

  // Только записи 'merge' — записи 'rollback' учитываются как «вычитающие» через NOT EXISTS.
  const whereConds: any[] = [
    eq(candidateMergeLog.action, 'merge'),
    inArray(candidateMergeLog.organizationId, orgIds),
  ]

  if (query.mergeKind !== 'all') {
    whereConds.push(eq(candidateMergeLog.mergeKind, query.mergeKind))
  }
  if (query.userId) {
    whereConds.push(eq(candidateMergeLog.performedByUserId, query.userId))
  }
  if (query.dateFrom) {
    whereConds.push(gte(candidateMergeLog.createdAt, new Date(query.dateFrom)))
  }
  if (query.dateTo) {
    whereConds.push(lte(candidateMergeLog.createdAt, new Date(query.dateTo)))
  }
  if (query.search) {
    const term = `%${query.search}%`
    whereConds.push(
      or(
        ilike(primary.firstName, term),
        ilike(primary.lastName, term),
        ilike(primary.email, term),
        ilike(merged.firstName, term),
        ilike(merged.lastName, term),
        ilike(merged.email, term),
      )!,
    )
  }

  // NOT EXISTS подзапрос для status filter — есть ли rollback-запись для этой пары?
  const rollbackExists = sql`EXISTS (
    SELECT 1 FROM candidate_merge_log r
    WHERE r.action = 'rollback'
      AND r.primary_candidate_id = ${candidateMergeLog.primaryCandidateId}
      AND r.merged_candidate_id = ${candidateMergeLog.mergedCandidateId}
      AND r.created_at > ${candidateMergeLog.createdAt}
  )`

  if (query.status === 'active') {
    whereConds.push(gte(candidateMergeLog.rollbackUntil, new Date()))
    whereConds.push(sql`NOT ${rollbackExists}`)
  }
  else if (query.status === 'expired') {
    whereConds.push(sql`${candidateMergeLog.rollbackUntil} < ${new Date()}`)
    whereConds.push(sql`NOT ${rollbackExists}`)
  }
  else if (query.status === 'rolled_back') {
    whereConds.push(rollbackExists)
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
