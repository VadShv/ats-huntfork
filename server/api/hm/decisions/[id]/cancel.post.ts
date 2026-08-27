import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { hmDecision } from '../../../../database/schema/hm'
import { cancelHmDecisionSchema } from '../../../../utils/schemas/hiringManager'

const paramsSchema = z.object({
  id: z.string().min(1).max(64),
})

/**
 * POST /api/hm/decisions/[id]/cancel
 * Рекрутер (owner/admin/member с application:update) отменяет ранее вынесенное решение НМ.
 *
 * Что делает:
 *   - Ставит is_effective=false, cancelled_at=now, cancelled_by_user_id=actor.
 *   - НЕ откатывает переход этапа — рекрутер после отмены сам двигает кандидата назад
 *     через обычный PATCH /api/applications/:id/stage. Так проще и прозрачнее в аудите.
 *   - Логирует hm_cancelled в activity_log.
 *
 * После отмены другой НМ может вынести новое решение — partial unique index больше
 * не блокирует (WHERE is_effective=true AND cancelled_at IS NULL).
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { application: ['update'] })
  const orgId = session.session.activeOrganizationId
  const actorId = session.user.id

  const { id: decisionId } = await getValidatedRouterParams(event, paramsSchema.parse)
  const body = await readValidatedBody(event, cancelHmDecisionSchema.parse)

  // Загружаем решение и проверяем принадлежность org
  const [existing] = await db
    .select({
      id: hmDecision.id,
      applicationId: hmDecision.applicationId,
      jobId: hmDecision.jobId,
      decision: hmDecision.decision,
      hmUserId: hmDecision.hmUserId,
      isEffective: hmDecision.isEffective,
      cancelledAt: hmDecision.cancelledAt,
    })
    .from(hmDecision)
    .where(and(
      eq(hmDecision.id, decisionId),
      eq(hmDecision.organizationId, orgId),
    ))
    .limit(1)

  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Решение не найдено' })
  }
  if (!existing.isEffective || existing.cancelledAt) {
    throw createError({ statusCode: 409, statusMessage: 'Решение уже отменено' })
  }

  await db
    .update(hmDecision)
    .set({
      isEffective: false,
      cancelledAt: new Date(),
      cancelledByUserId: actorId,
      cancelReason: body.reason,
    })
    .where(eq(hmDecision.id, decisionId))

  void recordActivity({
    organizationId: orgId,
    actorId,
    action: 'hm_cancelled',
    resourceType: 'hm_decision',
    resourceId: decisionId,
    metadata: {
      applicationId: existing.applicationId,
      jobId: existing.jobId,
      originalDecision: existing.decision,
      originalHmUserId: existing.hmUserId,
      ...(body.reason ? { reason: body.reason } : {}),
    },
  })

  return { success: true, decisionId }
})
