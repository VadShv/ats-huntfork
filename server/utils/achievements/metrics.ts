/**
 * Compute recruiter metrics from existing data (no new tracking tables).
 * All metrics are derived from applicationStageHistory + activityLog.
 * Uses a direct postgres client to bypass the lazy drizzle Proxy.
 */
import postgres from 'postgres'
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
}

export async function computeRecruiterMetrics(userId: string, orgId: string): Promise<RecruiterMetrics> {
  const client = postgres(env.DATABASE_URL, { max: 1, idle_timeout: 5 })
  try {
    // Stage move counts by type
    const stageRows = await client`
      SELECT ps.type, count(*)::int AS cnt
      FROM application_stage_history ash
      JOIN pipeline_stage ps ON ps.id = ash.to_stage_id
      WHERE ash.organization_id = ${orgId} AND ash.moved_by_user_id = ${userId}
      GROUP BY ps.type
    `
    const stageMap = new Map(stageRows.map((r: any) => [r.type, r.cnt]))
    const offersMade = stageMap.get('offer') ?? 0
    const offersAccepted = stageMap.get('hired') ?? 0
    const interviews = stageMap.get('interview') ?? 0
    const candidatesScreened = (stageMap.get('screening') ?? 0) + (stageMap.get('assessment') ?? 0) + (stageMap.get('contact') ?? 0)
    const offerAcceptRate = offersMade >= 10 ? Math.round((offersAccepted / offersMade) * 100) : 0

    // Vacancies closed
    const vacRows = await client`
      SELECT count(*)::int AS cnt FROM activity_log
      WHERE organization_id = ${orgId} AND actor_id = ${userId}
        AND action = 'status_changed' AND resource_type = 'job'
        AND metadata->>'to' = 'closed'
    `
    const vacanciesClosed = (vacRows[0] as any)?.cnt ?? 0

    // Fastest hire
    const fastRows = await client`
      SELECT min(extract(epoch from (ash.moved_at - a.created_at)) / 86400)::int AS days
      FROM application_stage_history ash
      JOIN application a ON a.id = ash.application_id
      JOIN pipeline_stage ps ON ps.id = ash.to_stage_id
      WHERE ash.organization_id = ${orgId} AND ash.moved_by_user_id = ${userId} AND ps.type = 'hired'
    `
    const fastestHireDays = (fastRows[0] as any)?.days ?? null

    // Activity streak
    const streakRows = await client`
      WITH active_days AS (
        SELECT DISTINCT DATE(created_at) AS d FROM activity_log
        WHERE organization_id = ${orgId} AND actor_id = ${userId}
      ), gaps AS (
        SELECT d, (d - (ROW_NUMBER() OVER (ORDER BY d))::int) AS grp FROM active_days
      )
      SELECT COALESCE(MAX(cnt), 0)::int AS streak
      FROM (SELECT grp, count(*)::int AS cnt FROM gaps GROUP BY grp) g
    `
    const activityStreak = (streakRows[0] as any)?.streak ?? 0

    // Special: night, morning, weekend
    const specialRows = await client`
      SELECT
        count(*) FILTER (WHERE extract(hour from created_at) >= 22)::int AS night,
        count(*) FILTER (WHERE extract(hour from created_at) < 7)::int AS morning,
        count(*) FILTER (WHERE extract(dow from created_at) IN (0, 6))::int AS weekend
      FROM activity_log WHERE organization_id = ${orgId} AND actor_id = ${userId}
    `
    const sp = specialRows[0] as any

    return {
      vacanciesClosed, offersMade, offersAccepted, interviews, candidatesScreened,
      offerAcceptRate, activityStreak, fastestHireDays,
      nightActivity: sp?.night ?? 0, morningActivity: sp?.morning ?? 0, weekendActivity: sp?.weekend ?? 0,
    }
  } finally {
    await client.end()
  }
}

