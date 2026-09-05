import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { kudos } from '../../database/schema'
import { GAMIFICATION_CONFIG } from '../../../shared/gamification-config'
import { weeklyPeriod } from '../../utils/quests/period'
import { creditCoins } from '../../utils/economy/wallet'

const bodySchema = z.object({
  toUserId: z.string().min(1),
  reason: z.string().trim().max(200).optional(),
})

/** POST /api/kudos — thank a colleague (rate-limited per week). */
export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const orgId = session.session.activeOrganizationId
  if (!orgId) throw createError({ statusCode: 403, statusMessage: 'Нет активной организации' })
  const userId = session.user.id
  const body = await readValidatedBody(event, bodySchema.parse)

  if (body.toUserId === userId) throw createError({ statusCode: 400, statusMessage: 'Нельзя поблагодарить самого себя' })

  const member = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM member WHERE organization_id = ${orgId} AND user_id = ${body.toUserId}
  `)
  if (Number((member as any[])[0]?.n ?? 0) === 0) throw createError({ statusCode: 404, statusMessage: 'Коллега не найден' })

  const week = weeklyPeriod().key

  // Weekly limit.
  const sent = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM kudos
    WHERE organization_id = ${orgId} AND from_user_id = ${userId} AND week_key = ${week}
  `)
  const sentCount = Number((sent as any[])[0]?.n ?? 0)
  if (sentCount >= GAMIFICATION_CONFIG.kudos.weeklyLimit) {
    throw createError({ statusCode: 400, statusMessage: `Лимит kudos на неделю исчерпан (${GAMIFICATION_CONFIG.kudos.weeklyLimit})` })
  }

  await db.insert(kudos).values({
    organizationId: orgId, fromUserId: userId, toUserId: body.toUserId, reason: body.reason ?? null, weekKey: week,
  })

  // Recognition reward → recipient.
  try { await creditCoins(body.toUserId, orgId, GAMIFICATION_CONFIG.kudos.coinReward, 'kudos', userId) } catch { /* best-effort */ }

  return { success: true, remaining: GAMIFICATION_CONFIG.kudos.weeklyLimit - sentCount - 1 }
})
