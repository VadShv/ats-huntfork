import { and, eq, sql } from 'drizzle-orm'
import { candidate, candidateIdentity, candidateMergeLog, organizationGroup } from '../../database/schema'
import { getOrgGroupId } from '../../utils/dedup/resolve'

/**
 * GET /api/dedup/diagnostics
 *
 * Диагностика состояния фундамента дедупликации:
 *   • есть ли группа у текущей org
 *   • сколько identity-записей у кандидатов организации
 *   • разбивка по kind
 *   • потенциальные дубли (несколько candidate.id с одинаковым valueNormalized в группе)
 *   • сколько merged кандидатов
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { candidate: ['read'] })
  const orgId = session.session.activeOrganizationId

  const groupId = await getOrgGroupId(orgId)

  let group: { id: string; name: string } | null = null
  if (groupId) {
    const [g] = await db
      .select({ id: organizationGroup.id, name: organizationGroup.name })
      .from(organizationGroup)
      .where(eq(organizationGroup.id, groupId))
      .limit(1)
    group = g ?? null
  }

  // Общая статистика кандидатов
  const [candStats] = await db
    .select({
      total: sql<number>`count(*)::int`,
      merged: sql<number>`count(*) FILTER (WHERE merge_status = 'merged')::int`,
      fraud: sql<number>`count(*) FILTER (WHERE fraud_flag = true)::int`,
    })
    .from(candidate)
    .where(eq(candidate.organizationId, orgId))

  // Identity по kind в рамках организации
  const identityByKind = await db
    .select({
      kind: candidateIdentity.kind,
      count: sql<number>`count(*)::int`,
    })
    .from(candidateIdentity)
    .where(eq(candidateIdentity.organizationId, orgId))
    .groupBy(candidateIdentity.kind)

  // Потенциальные дубли в группе: один и тот же valueNormalized у >1 кандидата
  // (но не считаем merged-кандидатов как дубли)
  let potentialDuplicates: Array<{ kind: string; valueNormalized: string; candidateCount: number }> = []
  if (groupId) {
    const rows = await db.execute<{ kind: string; value_normalized: string; candidate_count: number }>(sql`
      SELECT ci.kind, ci.value_normalized, COUNT(DISTINCT ci.candidate_id)::int AS candidate_count
      FROM candidate_identity ci
      INNER JOIN candidate c ON c.id = ci.candidate_id
      WHERE ci.group_id = ${groupId}
        AND c.merge_status = 'active'
      GROUP BY ci.kind, ci.value_normalized
      HAVING COUNT(DISTINCT ci.candidate_id) > 1
      ORDER BY candidate_count DESC, ci.kind
      LIMIT 50
    `)
    const arr = (rows as any).rows ?? rows
    potentialDuplicates = (Array.isArray(arr) ? arr : []).map((r: any) => ({
      kind: r.kind,
      valueNormalized: r.value_normalized,
      candidateCount: r.candidate_count,
    }))
  }

  // Сколько было merge-операций
  const [mergeStats] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(candidateMergeLog)
    .where(and(eq(candidateMergeLog.organizationId, orgId), eq(candidateMergeLog.action, 'merge')))

  return {
    organizationId: orgId,
    group,
    candidates: {
      total: candStats?.total ?? 0,
      merged: candStats?.merged ?? 0,
      fraud: candStats?.fraud ?? 0,
    },
    identitiesByKind: identityByKind.map(r => ({ kind: r.kind, count: r.count })),
    potentialDuplicates: {
      total: potentialDuplicates.length,
      samples: potentialDuplicates,
    },
    merges: {
      total: mergeStats?.total ?? 0,
    },
  }
})
