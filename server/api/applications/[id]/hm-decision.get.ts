import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { application } from '../../../database/schema/app'
import { hmDecision } from '../../../database/schema/hm'
import * as authSchema from '../../../database/schema/auth'

const paramsSchema = z.object({
  id: z.string().min(1).max(64),
})

/**
 * GET /api/applications/[id]/hm-decision
 * Возвращает актуальное эффективное решение НМ по отклику + краткие сведения
 * об НМ (имя, email). Для рекрутера/админа, чтобы отрисовать панель отмены.
 * Возвращает { decision: null } если решения нет.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { application: ['read'] })
  const orgId = session.session.activeOrganizationId

  const { id: applicationId } = await getValidatedRouterParams(event, paramsSchema.parse)

  const [app] = await db
    .select({ id: application.id })
    .from(application)
    .where(and(
      eq(application.id, applicationId),
      eq(application.organizationId, orgId),
    ))
    .limit(1)
  if (!app) {
    throw createError({ statusCode: 404, statusMessage: 'Отклик не найден' })
  }

  const [row] = await db
    .select({
      id: hmDecision.id,
      decision: hmDecision.decision,
      hmUserId: hmDecision.hmUserId,
      decidedAt: hmDecision.decidedAt,
      comment: hmDecision.comment,
      hmName: authSchema.user.name,
      hmEmail: authSchema.user.email,
    })
    .from(hmDecision)
    .leftJoin(authSchema.user, eq(authSchema.user.id, hmDecision.hmUserId))
    .where(and(
      eq(hmDecision.applicationId, applicationId),
      eq(hmDecision.isEffective, true),
    ))
    .limit(1)

  if (!row) {
    return { decision: null }
  }

  return {
    decision: {
      id: row.id,
      decision: row.decision,
      decidedAt: row.decidedAt,
      comment: row.comment,
      hm: {
        userId: row.hmUserId,
        name: row.hmName,
        email: row.hmEmail,
      },
    },
  }
})
