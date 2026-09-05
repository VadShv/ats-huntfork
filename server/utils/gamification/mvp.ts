/**
 * Weekly MVP — the recruiter with the biggest RP gain this week, announced
 * to the org's Telegram channel (best-effort, gated on gamification_settings).
 */
import { eq, sql } from 'drizzle-orm'
import { gamificationSettings, commsTelegramBot } from '../../database/schema'
import { getOrCreateCurrentSeason } from '../huntpass/season'
import { getBotToken, tgSendMessage } from '../comms/telegram'
import { weeklyPeriod } from '../quests/period'

export interface Mvp {
  userId: string
  name: string
  delta: number
  rp: number
}

/** Compute the current-season MVP by weekly RP gain (latest - previous snapshot). */
export async function computeWeeklyMvp(orgId: string): Promise<Mvp | null> {
  const s = await getOrCreateCurrentSeason()
  // Per user: last two weekly snapshots for the season.
  const rows = await db.execute<{ user_id: string, name: string, latest: number, prev: number }>(sql`
    WITH ranked AS (
      SELECT rh.user_id, rh.rp, rh.week_key,
             ROW_NUMBER() OVER (PARTITION BY rh.user_id ORDER BY rh.week_key DESC) AS rn
      FROM rank_history rh
      WHERE rh.organization_id = ${orgId} AND rh.season_id = ${s.id}
    )
    SELECT r1.user_id,
           COALESCE(u.name, u.email) AS name,
           r1.rp AS latest,
           COALESCE(r2.rp, 0) AS prev
    FROM ranked r1
    LEFT JOIN ranked r2 ON r2.user_id = r1.user_id AND r2.rn = 2
    JOIN "user" u ON u.id = r1.user_id
    WHERE r1.rn = 1
  `)

  let best: Mvp | null = null
  for (const r of rows as any[]) {
    const delta = Number(r.latest) - Number(r.prev)
    const rp = Number(r.latest)
    if (delta <= 0) continue
    if (!best || delta > best.delta || (delta === best.delta && rp > best.rp)) {
      best = { userId: r.user_id, name: r.name, delta, rp }
    }
  }
  return best
}

export interface TeamPlayer { userId: string, name: string, assists: number, kudos: number, score: number }

/** Compute the weekly Team Player: top by (assists + kudos received) this week. */
export async function computeTeamPlayer(orgId: string): Promise<TeamPlayer | null> {
  const week = weeklyPeriod()
  const start = week.start.toISOString()
  const end = week.end.toISOString()
  const rows = await db.execute<{ user_id: string, name: string, assists: number, kudos: number }>(sql`
    WITH a AS (
      SELECT from_user_id AS uid, count(*)::int AS assists FROM referral
      WHERE organization_id = ${orgId} AND status = 'hired' AND resolved_at >= ${start} AND resolved_at <= ${end}
      GROUP BY from_user_id
    ), k AS (
      SELECT to_user_id AS uid, count(*)::int AS kudos FROM kudos
      WHERE organization_id = ${orgId} AND created_at >= ${start} AND created_at <= ${end}
      GROUP BY to_user_id
    ), ids AS (SELECT uid FROM a UNION SELECT uid FROM k)
    SELECT ids.uid AS user_id, COALESCE(u.name, u.email) AS name,
           COALESCE(a.assists, 0) AS assists, COALESCE(k.kudos, 0) AS kudos
    FROM ids
    LEFT JOIN a ON a.uid = ids.uid
    LEFT JOIN k ON k.uid = ids.uid
    JOIN "user" u ON u.id = ids.uid
  `)
  let best: TeamPlayer | null = null
  for (const r of rows as any[]) {
    const assists = Number(r.assists), kudos = Number(r.kudos)
    const score = assists * 3 + kudos // assist weighs more than a kudos
    if (score <= 0) continue
    if (!best || score > best.score) best = { userId: r.user_id, name: r.name, assists, kudos, score }
  }
  return best
}

/** Announce the weekly MVP to the org's Telegram channel (no-op if not configured). */
export async function pushMvpToTelegram(orgId: string): Promise<boolean> {
  const settings = await db.query.gamificationSettings.findFirst({
    where: eq(gamificationSettings.organizationId, orgId),
  })
  if (!settings?.mvpEnabled || !settings.mvpTelegramChatId) return false

  const bot = await db.query.commsTelegramBot.findFirst({
    where: eq(commsTelegramBot.organizationId, orgId),
  })
  if (!bot) return false

  const [mvp, teamPlayer] = await Promise.all([computeWeeklyMvp(orgId), computeTeamPlayer(orgId)])
  if (!mvp && !teamPlayer) return false

  const parts: string[] = []
  if (mvp) parts.push(`🏆 <b>MVP недели</b>\n${mvp.name} — <b>+${mvp.delta} RP</b> (всего ${mvp.rp} RP).`)
  if (teamPlayer) parts.push(`🤝 <b>Командный игрок недели</b>\n${teamPlayer.name} — ${teamPlayer.assists} ассистов, ${teamPlayer.kudos} kudos.`)

  try {
    const token = getBotToken(bot)
    await tgSendMessage(token, settings.mvpTelegramChatId, parts.join('\n\n') + '\n\nОтличная работа! 🚀')
    return true
  } catch (e) {
    console.warn('[mvp] telegram push failed', (e as Error).message)
    return false
  }
}
