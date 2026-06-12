import { and, eq, gte, ilike, inArray, lte, or, sql, type SQL } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { candidate, candidateMergeLog, organizationExt } from '../../database/schema'
import { getOrgGroupId } from './resolve'

/**
 * Sprint 4.1 (P3.1): общий билдер фильтров для журнала merge.
 * Используется обычным GET `/api/dedup/merges` и экспортом CSV/XLSX.
 */
export interface MergesQueryFilters {
  status: 'active' | 'expired' | 'rolled_back' | 'all'
  mergeKind: 'auto' | 'manual' | 'all'
  userId?: string
  dateFrom?: string
  dateTo?: string
  search?: string
  includeOtherOrgs: boolean
}

export interface MergesQueryContext {
  primary: ReturnType<typeof alias<typeof candidate, 'primary'>>
  merged: ReturnType<typeof alias<typeof candidate, 'merged'>>
  whereConds: SQL[]
  rollbackExists: SQL
  orgIds: string[]
}

/** Подготавливает orgIds, алиасы primary/merged и список условий WHERE. */
export async function buildMergesQuery(
  orgId: string,
  filters: MergesQueryFilters,
): Promise<MergesQueryContext> {
  // 1. orgIds — текущая или вся группа
  let orgIds: string[] = [orgId]
  if (filters.includeOtherOrgs) {
    const groupId = await getOrgGroupId(orgId)
    if (groupId) {
      const arr = await db
        .select({ id: organizationExt.id })
        .from(organizationExt)
        .where(eq(organizationExt.groupId, groupId))
      orgIds = arr.map(r => r.id)
      if (!orgIds.includes(orgId)) orgIds.push(orgId)
    }
  }

  const primary = alias(candidate, 'primary')
  const merged = alias(candidate, 'merged')

  const whereConds: SQL[] = [
    eq(candidateMergeLog.action, 'merge'),
    inArray(candidateMergeLog.organizationId, orgIds),
  ]

  if (filters.mergeKind !== 'all') {
    whereConds.push(eq(candidateMergeLog.mergeKind, filters.mergeKind))
  }
  if (filters.userId) {
    whereConds.push(eq(candidateMergeLog.performedByUserId, filters.userId))
  }
  if (filters.dateFrom) {
    whereConds.push(gte(candidateMergeLog.createdAt, new Date(filters.dateFrom)))
  }
  if (filters.dateTo) {
    whereConds.push(lte(candidateMergeLog.createdAt, new Date(filters.dateTo)))
  }
  if (filters.search) {
    const term = `%${filters.search}%`
    const o = or(
      ilike(primary.firstName, term),
      ilike(primary.lastName, term),
      ilike(primary.email, term),
      ilike(merged.firstName, term),
      ilike(merged.lastName, term),
      ilike(merged.email, term),
    )
    if (o) whereConds.push(o)
  }

  const rollbackExists = sql`EXISTS (
    SELECT 1 FROM candidate_merge_log r
    WHERE r.action = 'rollback'
      AND r.primary_candidate_id = ${candidateMergeLog.primaryCandidateId}
      AND r.merged_candidate_id = ${candidateMergeLog.mergedCandidateId}
      AND r.created_at > ${candidateMergeLog.createdAt}
  )`

  if (filters.status === 'active') {
    whereConds.push(gte(candidateMergeLog.rollbackUntil, new Date()))
    whereConds.push(sql`NOT ${rollbackExists}`)
  }
  else if (filters.status === 'expired') {
    whereConds.push(sql`${candidateMergeLog.rollbackUntil} < ${new Date()}`)
    whereConds.push(sql`NOT ${rollbackExists}`)
  }
  else if (filters.status === 'rolled_back') {
    whereConds.push(rollbackExists)
  }

  return { primary, merged, whereConds, rollbackExists, orgIds }
}

/** Утилита: совместимая с `db.where(...)` свёртка условий. */
export function combineWhere(conds: SQL[]): SQL | undefined {
  return and(...conds)
}
