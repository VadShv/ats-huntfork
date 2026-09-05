import { and, eq, or, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { duel } from '../../database/schema'
import { GAMIFICATION_CONFIG } from '../../../shared/gamification-config'

const metricKeys = GAMIFICATION_CONFIG.duel.metrics.map(m => m.key)
const bodySchema = z.object({
  opponentId: z.string().min(1),
  metric: z.string().refine(k => metricKeys.includes(k), 'Недопустимая метрика'),
})

/** POST /api/duels — challenge a colleague to a 1v1 duel (status: pending). */
export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const orgId = session.session.activeOrganizationId
  if (!orgId) throw createError({ statusCode: 403, statusMessage: 'Нет активной организации' })
  const userId = session.user.id
  const body = await readValidatedBody(event, bodySchema.parse)

  if (body.opponentId === userId) throw createError({ statusCode: 400, statusMessage: 'Нельзя вызвать самого себя' })

  // Opponent must be in the org.
  const opp = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM member WHERE organization_id = ${orgId} AND user_id = ${body.opponentId}
  `)
  if (Number((opp as any[])[0]?.n ?? 0) === 0) throw createError({ statusCode: 404, statusMessage: 'Соперник не найден' })

  // Limit active/pending duels per challenger.
  const active = await db.query.duel.findMany({
    where: and(eq(duel.organizationId, orgId), eq(duel.challengerId, userId), inArray(duel.status, ['pending', 'active'])),
  })
  if (active.length >= GAMIFICATION_CONFIG.duel.maxActivePerUser) {
    throw createError({ statusCode: 400, statusMessage: 'Слишком много активных дуэлей' })
  }

  // No duplicate pending/active duel with the same opponent.
  const dup = await db.query.duel.findFirst({
    where: and(
      eq(duel.organizationId, orgId),
      inArray(duel.status, ['pending', 'active']),
      or(
        and(eq(duel.challengerId, userId), eq(duel.opponentId, body.opponentId)),
        and(eq(duel.challengerId, body.opponentId), eq(duel.opponentId, userId)),
      ),
    ),
  })
  if (dup) throw createError({ statusCode: 409, statusMessage: 'Дуэль с этим соперником уже идёт' })

  const [row] = await db.insert(duel).values({
    organizationId: orgId, challengerId: userId, opponentId: body.opponentId, metric: body.metric, status: 'pending',
  }).returning()

  return { id: row.id, status: row.status }
})
