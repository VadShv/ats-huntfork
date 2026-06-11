import { and, eq, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { candidate, candidateMergeLog, user } from '../../../database/schema'
import { getOrgGroupId } from '../../../utils/dedup/resolve'

/**
 * GET /api/dedup/merges/:id
 *
 * Детальная запись merge: snapshot (что было ДО), сигналы, причина,
 * текущее состояние обоих кандидатов, исполнитель, флаг возможности отката.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { candidate: ['read'] })
  const orgId = session.session.activeOrganizationId
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id обязателен' })

  const primary = alias(candidate, 'primary')
  const merged = alias(candidate, 'merged')

  const [row] = await db
    .select({
      id: candidateMergeLog.id,
      organizationId: candidateMergeLog.organizationId,
      groupId: candidateMergeLog.groupId,
      createdAt: candidateMergeLog.createdAt,
      action: candidateMergeLog.action,
      mergeKind: candidateMergeLog.mergeKind,
      score: candidateMergeLog.score,
      reason: candidateMergeLog.reason,
      signals: candidateMergeLog.signals,
      snapshot: candidateMergeLog.snapshot,
      rollbackUntil: candidateMergeLog.rollbackUntil,
      primaryCandidateId: candidateMergeLog.primaryCandidateId,
      mergedCandidateId: candidateMergeLog.mergedCandidateId,
      primaryFirstName: primary.firstName,
      primaryLastName: primary.lastName,
      primaryEmail: primary.email,
      primaryMergeStatus: primary.mergeStatus,
      primaryFraudFlag: primary.fraudFlag,
      mergedFirstName: merged.firstName,
      mergedLastName: merged.lastName,
      mergedEmail: merged.email,
      mergedMergeStatus: merged.mergeStatus,
      performerId: user.id,
      performerName: user.name,
      performerEmail: user.email,
    })
    .from(candidateMergeLog)
    .leftJoin(primary, eq(primary.id, candidateMergeLog.primaryCandidateId))
    .leftJoin(merged, eq(merged.id, candidateMergeLog.mergedCandidateId))
    .leftJoin(user, eq(user.id, candidateMergeLog.performedByUserId))
    .where(eq(candidateMergeLog.id, id))
    .limit(1)

  if (!row) throw createError({ statusCode: 404, statusMessage: 'Запись не найдена' })

  // Проверка доступа: запись должна принадлежать org пользователя или его группе
  if (row.organizationId !== orgId) {
    const userGroup = await getOrgGroupId(orgId)
    if (!userGroup || userGroup !== row.groupId) {
      throw createError({ statusCode: 403, statusMessage: 'Нет доступа к этой записи' })
    }
  }

  // Проверим есть ли rollback после этой merge
  const createdAtIso = (row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt!)).toISOString()
  const rbRes: any = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM candidate_merge_log r
      WHERE r.action = 'rollback'
        AND r.primary_candidate_id = ${row.primaryCandidateId}
        AND r.merged_candidate_id = ${row.mergedCandidateId}
        AND r.created_at > ${createdAtIso}::timestamp
    ) AS exists_flag
  `)
  const rbArr: Array<{ exists_flag: boolean }> = Array.isArray(rbRes) ? rbRes : (rbRes.rows ?? [])
  const isRolledBack = Boolean(rbArr[0]?.exists_flag)

  const now = Date.now()
  const daysUntilExpiry = row.rollbackUntil
    ? Math.max(0, Math.ceil((new Date(row.rollbackUntil).getTime() - now) / (1000 * 60 * 60 * 24)))
    : 0
  const canRollback = !isRolledBack && row.rollbackUntil && new Date(row.rollbackUntil).getTime() > now

  const snap = row.snapshot as any
  const snapPrimary = snap?.primary ?? null
  const snapMerged = snap?.merged ?? null

  return {
    id: row.id,
    createdAt: row.createdAt,
    action: row.action,
    mergeKind: row.mergeKind,
    score: row.score,
    reason: row.reason,
    signals: row.signals ?? {},
    rollbackUntil: row.rollbackUntil,
    daysUntilExpiry,
    canRollback: Boolean(canRollback),
    isRolledBack,
    primary: {
      id: row.primaryCandidateId,
      // ДО слияния — из snapshot
      before: snapPrimary
        ? {
            firstName: snapPrimary.firstName ?? null,
            lastName: snapPrimary.lastName ?? null,
            email: snapPrimary.email ?? null,
            phone: snapPrimary.phone ?? null,
            dateOfBirth: snapPrimary.dateOfBirth ?? null,
          }
        : null,
      // СЕЙЧАС — из join
      current: row.primaryFirstName !== null || row.primaryLastName !== null
        ? {
            firstName: row.primaryFirstName,
            lastName: row.primaryLastName,
            email: row.primaryEmail,
            mergeStatus: row.primaryMergeStatus,
            fraudFlag: row.primaryFraudFlag ?? false,
          }
        : null,
    },
    merged: {
      id: row.mergedCandidateId,
      before: snapMerged
        ? {
            firstName: snapMerged.firstName ?? null,
            lastName: snapMerged.lastName ?? null,
            email: snapMerged.email ?? null,
            phone: snapMerged.phone ?? null,
            dateOfBirth: snapMerged.dateOfBirth ?? null,
          }
        : null,
      current: row.mergedFirstName !== null || row.mergedLastName !== null
        ? {
            firstName: row.mergedFirstName,
            lastName: row.mergedLastName,
            email: row.mergedEmail,
            mergeStatus: row.mergedMergeStatus,
          }
        : null,
    },
    performedBy: row.performerId
      ? { id: row.performerId, name: row.performerName, email: row.performerEmail }
      : null,
  }
})
