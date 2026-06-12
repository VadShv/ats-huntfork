import { and, desc, eq } from 'drizzle-orm'
import { candidateMergeLog, user } from '../../../database/schema'

/**
 * GET /api/candidates/:id/merge-history
 *
 * Sprint 4.6 (P3.6): возвращает историю слияний, где данный кандидат был primary —
 * для отображения блока «История слияний» на карточке кандидата.
 *
 * Включает merge-действия и rollback-действия (если были).
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { candidate: ['read'] })
  const orgId = session.session.activeOrganizationId
  const candidateId = getRouterParam(event, 'id')
  if (!candidateId) throw createError({ statusCode: 400, statusMessage: 'candidate id required' })

  const rows = await db
    .select({
      id: candidateMergeLog.id,
      action: candidateMergeLog.action,
      mergeKind: candidateMergeLog.mergeKind,
      reason: candidateMergeLog.reason,
      score: candidateMergeLog.score,
      signals: candidateMergeLog.signals,
      mergedCandidateId: candidateMergeLog.mergedCandidateId,
      rollbackUntil: candidateMergeLog.rollbackUntil,
      createdAt: candidateMergeLog.createdAt,
      performedByUserId: candidateMergeLog.performedByUserId,
      performedByName: user.name,
      performedByEmail: user.email,
    })
    .from(candidateMergeLog)
    .leftJoin(user, eq(user.id, candidateMergeLog.performedByUserId))
    .where(
      and(
        eq(candidateMergeLog.primaryCandidateId, candidateId),
        eq(candidateMergeLog.organizationId, orgId),
      ),
    )
    .orderBy(desc(candidateMergeLog.createdAt))
    .limit(50)

  return {
    items: rows.map(r => ({
      id: r.id,
      action: r.action, // 'merge' | 'rollback'
      mergeKind: r.mergeKind, // 'auto' | 'manual'
      reason: r.reason,
      score: r.score,
      signals: r.signals ?? [],
      mergedCandidateId: r.mergedCandidateId,
      rollbackUntil: r.rollbackUntil,
      createdAt: r.createdAt,
      performedBy: r.performedByUserId
        ? {
            id: r.performedByUserId,
            name: r.performedByName,
            email: r.performedByEmail,
          }
        : null,
    })),
  }
})
