/**
 * HuntPass SXP computation — derived from existing data within the season window.
 * No SXP is stored; it is recomputed from application_stage_history + activity_log.
 */
import { sql } from 'drizzle-orm'
import { db } from '../db'
import { SXP_WEIGHTS, hireQualityFactor } from '../../../shared/season-track'

export interface SxpBreakdown {
  sxp: number
  hires: number
  offers: number
  interviews: number
  vacanciesClosed: number
  qualityFactor: number
}

export async function computeSeasonSxp(
  userId: string,
  orgId: string,
  startsAt: Date,
  endsAt: Date,
): Promise<SxpBreakdown> {
  const start = startsAt.toISOString()
  const end = endsAt.toISOString()

  // Stage moves in window, by type
  const stageRows = await db.execute<{ type: string, cnt: number }>(sql`
    SELECT ps.type AS type, count(*)::int AS cnt
    FROM application_stage_history ash
    JOIN pipeline_stage ps ON ps.id = ash.to_stage_id
    WHERE ash.organization_id = ${orgId}
      AND ash.moved_by_user_id = ${userId}
      AND ash.moved_at >= ${start} AND ash.moved_at <= ${end}
    GROUP BY ps.type
  `)
  const map = new Map((stageRows as any[]).map(r => [r.type, Number(r.cnt)]))
  const hires = map.get('hired') ?? 0
  const offers = map.get('offer') ?? 0
  const interviews = map.get('interview') ?? 0

  // Vacancies closed in window
  const vacRows = await db.execute<{ cnt: number }>(sql`
    SELECT count(*)::int AS cnt FROM activity_log
    WHERE organization_id = ${orgId} AND actor_id = ${userId}
      AND action = 'status_changed' AND resource_type = 'job'
      AND metadata->>'to' = 'closed'
      AND created_at >= ${start} AND created_at <= ${end}
  `)
  const vacanciesClosed = Number((vacRows as any[])[0]?.cnt ?? 0)

  const qualityFactor = hireQualityFactor(hires, offers)
  const sxp = Math.round(
    hires * SXP_WEIGHTS.hire * qualityFactor
    + offers * SXP_WEIGHTS.offer
    + interviews * SXP_WEIGHTS.interview
    + vacanciesClosed * SXP_WEIGHTS.vacancyClosed,
  )

  return { sxp, hires, offers, interviews, vacanciesClosed, qualityFactor }
}
