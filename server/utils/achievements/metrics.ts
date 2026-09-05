/**
 * Compute recruiter metrics from existing data (no new tracking tables).
 * All metrics are derived from applicationStageHistory + activityLog.
 */
import { sql } from 'drizzle-orm'
import { db } from '../db'
import { env } from '../env'

export interface RecruiterMetrics {
  vacanciesClosed: number
  offersMade: number
  offersAccepted: number
  interviews: number
  candidatesScreened: number
  offerAcceptRate: number
  activityStreak: number
  fastestHireDays: number | null
  nightActivity: number
  morningActivity: number
  weekendActivity: number
  assists: number
}

export async function computeRecruiterMetrics(userId: string, orgId: string): Promise<RecruiterMetrics> {
  const tz = env.APP_TIMEZONE

  // Stage move counts by type — attributed to the recruiter who moved the application
  const stageRows = await db.execute<{ type: string, cnt: number }>(sql`
    SELECT ps.type AS type, count(*)::int AS cnt
    FROM application_stage_history ash
    JOIN pipeline_stage ps ON ps.id = ash.to_stage_id
    WHERE ash.organization_id = ${orgId} AND ash.moved_by_user_id = ${userId}
    GROUP BY ps.type
  `)
  const stageMap = new Map((stageRows as any[]).map(r => [r.type, Number(r.cnt)]))
  const offersMade = stageMap.get('offer') ?? 0
  const offersAccepted = stageMap.get('hired') ?? 0
  const interviews = stageMap.get('interview') ?? 0
  const candidatesScreened = (stageMap.get('screening') ?? 0) + (stageMap.get('assessment') ?? 0) + (stageMap.get('contact') ?? 0)
  const offerAcceptRate = offersMade >= 10 ? Math.round((offersAccepted / offersMade) * 100) : 0

  // Vacancies closed — activityLog: action='status_changed', metadata.to='closed'
  const vacRows = await db.execute<{ cnt: number }>(sql`
    SELECT count(*)::int AS cnt FROM activity_log
    WHERE organization_id = ${orgId} AND actor_id = ${userId}
      AND action = 'status_changed' AND resource_type = 'job'
      AND metadata->>'to' = 'closed'
  `)
  const vacanciesClosed = Number((vacRows as any[])[0]?.cnt ?? 0)

  // Fastest hire — min days from application.created_at to hire stage move
  const fastRows = await db.execute<{ days: number | null }>(sql`
    SELECT min(extract(epoch from (ash.moved_at - a.created_at)) / 86400)::int AS days
    FROM application_stage_history ash
    JOIN application a ON a.id = ash.application_id
    JOIN pipeline_stage ps ON ps.id = ash.to_stage_id
    WHERE ash.organization_id = ${orgId} AND ash.moved_by_user_id = ${userId} AND ps.type = 'hired'
  `)
  const fastestHireDays = (fastRows as any[])[0]?.days ?? null

  // Activity streak — longest run of consecutive active days
  const streakRows = await db.execute<{ streak: number }>(sql`
    WITH active_days AS (
      SELECT DISTINCT DATE(created_at AT TIME ZONE 'UTC' AT TIME ZONE ${tz}) AS d
      FROM activity_log
      WHERE organization_id = ${orgId} AND actor_id = ${userId}
    ), gaps AS (
      SELECT d, (d - (ROW_NUMBER() OVER (ORDER BY d))::int) AS grp FROM active_days
    )
    SELECT COALESCE(MAX(cnt), 0)::int AS streak
    FROM (SELECT grp, count(*)::int AS cnt FROM gaps GROUP BY grp) g
  `)
  const activityStreak = Number((streakRows as any[])[0]?.streak ?? 0)

  // Special: night (>=22:00), morning (<07:00), weekend (Sat/Sun) — in APP_TIMEZONE, not UTC
  const specialRows = await db.execute<{ night: number, morning: number, weekend: number }>(sql`
    SELECT
      count(*) FILTER (WHERE extract(hour from created_at AT TIME ZONE 'UTC' AT TIME ZONE ${tz}) >= 22)::int AS night,
      count(*) FILTER (WHERE extract(hour from created_at AT TIME ZONE 'UTC' AT TIME ZONE ${tz}) < 7)::int AS morning,
      count(*) FILTER (WHERE extract(dow from created_at AT TIME ZONE 'UTC' AT TIME ZONE ${tz}) IN (0, 6))::int AS weekend
    FROM activity_log WHERE organization_id = ${orgId} AND actor_id = ${userId}
  `)
  const sp = (specialRows as any[])[0]

  // Assists (lifetime): referred candidates that got hired.
  const assistRows = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM referral
    WHERE organization_id = ${orgId} AND from_user_id = ${userId} AND status = 'hired'
  `)
  const assists = Number((assistRows as any[])[0]?.n ?? 0)

  return {
    vacanciesClosed, offersMade, offersAccepted, interviews, candidatesScreened,
    offerAcceptRate, activityStreak, fastestHireDays,
    nightActivity: Number(sp?.night ?? 0),
    morningActivity: Number(sp?.morning ?? 0),
    weekendActivity: Number(sp?.weekend ?? 0),
    assists,
  }
}
