import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { duel } from '../../../database/schema'
import { GAMIFICATION_CONFIG } from '../../../../shared/gamification-config'

const paramsSchema = z.object({ id: z.string().min(1) })
const bodySchema = z.object({ accept: z.boolean() })

/** POST /api/duels/:id/respond — opponent accepts (→ active) or declines. */
export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const orgId = session.session.activeOrganizationId
  if (!orgId) throw createError({ statusCode: 403, statusMessage: 'Нет активной организации' })
  const userId = session.user.id
  const { id } = await getValidatedRouterParams(event, paramsSchema.parse)
  const { accept } = await readValidatedBody(event, bodySchema.parse)

  const d = await db.query.duel.findFirst({
    where: and(eq(duel.id, id), eq(duel.organizationId, orgId)),
  })
  if (!d) throw createError({ statusCode: 404, statusMessage: 'Дуэль не найдена' })
  if (d.opponentId !== userId) throw createError({ statusCode: 403, statusMessage: 'Только соперник может ответить' })
  if (d.status !== 'pending') throw createError({ statusCode: 409, statusMessage: 'Дуэль уже не в ожидании' })

  if (!accept) {
    await db.update(duel).set({ status: 'declined', resolvedAt: new Date() }).where(eq(duel.id, id))
    return { status: 'declined' }
  }

  const startsAt = new Date()
  const endsAt = new Date(startsAt.getTime() + GAMIFICATION_CONFIG.duel.durationDays * 86_400_000)
  await db.update(duel).set({ status: 'active', startsAt, endsAt }).where(eq(duel.id, id))
  return { status: 'active', startsAt, endsAt }
})
