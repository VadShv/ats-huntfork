import { z } from 'zod'
import { rollbackMerge } from '../../../../utils/dedup/merge'

const bodySchema = z.object({
  reason: z.string().max(500).optional(),
}).partial()

/**
 * POST /api/dedup/merges/:id/rollback
 *
 * Откатывает merge по id записи candidate_merge_log.
 * Доступ: candidate.update.
 *
 * Ограничения (валидация в rollbackMerge):
 *   • action='merge' (не повторный откат)
 *   • rollback_until > now() (окно 30 дней)
 *   • нет уже записанного rollback для этой пары
 *   • snapshot содержит transferred-поля (создан в новой версии)
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { candidate: ['update'] })
  const orgId = session.session.activeOrganizationId

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'id обязателен' })
  }

  const body = await readValidatedBody(event, bodySchema.parse)

  // Проверим, что запись принадлежит текущей org (защита от cross-org)
  const { db } = await import('../../../../utils/db')
  const { candidateMergeLog } = await import('../../../../database/schema')
  const { eq } = await import('drizzle-orm')
  const [log] = await db
    .select({ id: candidateMergeLog.id, organizationId: candidateMergeLog.organizationId })
    .from(candidateMergeLog)
    .where(eq(candidateMergeLog.id, id))
    .limit(1)
  if (!log) {
    throw createError({ statusCode: 404, statusMessage: 'Запись не найдена' })
  }
  if (log.organizationId !== orgId) {
    throw createError({ statusCode: 403, statusMessage: 'Нет доступа к этой записи' })
  }

  const result = await rollbackMerge({
    mergeLogId: id,
    userId: session.user.id,
    reason: body.reason ?? null,
  })

  recordActivity({
    organizationId: orgId,
    actorId: session.user.id,
    action: 'updated',
    resourceType: 'candidate_merge',
    resourceId: result.rollbackLogId,
    metadata: {
      kind: 'rollback_merge',
      primaryCandidateId: result.primaryCandidateId,
      mergedCandidateId: result.mergedCandidateId,
      restored: result.restored,
    },
  })

  logInfo('dedup.merge_rolled_back', {
    merge_log_id: id,
    rollback_log_id: result.rollbackLogId,
    organization_id: orgId,
    actor_id: session.user.id,
    restored_apps: result.restored.applications,
    restored_docs: result.restored.documents,
    restored_identities: result.restored.identities,
    module: 'dedup',
  })

  return result
})
