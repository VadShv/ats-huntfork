/**
 * Compute recruiter metrics from existing data (no new tracking tables).
 * All metrics are derived from applicationStageHistory + activityLog.
 */
import { sql } from 'drizzle-orm'
import { db } from '../db'

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
  // Stage move counts by type — attributed to the recruiter who moved the application
  const stageCounts = await db.execute<{ stage_type: string, cnt: number }>(sql`
    SELECT ps.type AS stage_type, COUNT(*)::int AS cnt
    FROM application_stage_history ash
    JOIN pipeline_stage ps ON ps.id = ash.to_stage_id
    WHERE ash.organization_id = ${orgId}
      AND ash.moved_by_user_id = ${userId}
      AND ps.type IN ('offer', 'interview', 'hired', 'screening', 'assessment', 'contact')
    GROUP BY ps.type
  `)
  const stageMap = new Map(stageCounts.map(r => [r.stage_type, r.cnt]))
  const offersMade = stageMap.get('offer') ?? 0
  const offersAccepted = stageMap.get('hired') ?? 0
  const interviews = stageMap.get('interview') ?? 0
  const candidatesScreened = (stageMap.get('screening') ?? 0) + (stageMap.get('assessment') ?? 0) + (stageMap.get('contact') ?? 0)
  const offerAcceptRate = offersMade >= 10 ? Math.round((offersAccepted / offersMade) * 100) : 0

  // Vacancies closed — from activityLog (action='status_changed', metadata.to='closed')
  const [vacClosed] = await db.execute<{ cnt: number }>(sql`
    SELECT COUNT(*)::int AS cnt
    FROM activity_log
    WHERE organization_id = ${orgId}
      AND actor_id = ${userId}
      AND action = 'status_changed'
      AND resource_type = 'job'
      AND metadata->>'to' = 'closed'
  `)

  // Fastest hire — min days from application.created_at to hire stage move
  const [fastHire] = await db.execute<{ days: number | null }>(sql`
    SELECT MIN(EXTRACT(EPOCH FROM (ash.moved_at - a.created_at)) / 86400)::int AS days
    FROM application_stage_history ash
    JOIN application a ON a.id = ash.application_id
    JOIN pipeline_stage ps ON ps.id = ash.to_stage_id
    WHERE ash.organization_id = ${orgId}
      AND ash.moved_by_user_id = ${userId}
      AND ps.type = 'hired'
  `)

  // Activity streak — consecutive days with any activity by the user
  const [streak] = await db.execute<{ streak: number }>(sql`
    WITH active_days AS (
      SELECT DISTINCT DATE(created_at) AS d
      FROM activity_log
      WHERE organization_id = ${orgId} AND actor_id = ${userId}
    ),
    gaps AS (
      SELECT d, d - (ROW_NUMBER() OVER (ORDER BY d))::int AS grp
      FROM active_days
    )
    SELECT COALESCE(MAX(cnt), 0)::int AS streak
    FROM (SELECT grp, COUNT(*)::int AS cnt FROM gaps GROUP BY grp) g
  `)

  // Special: night (>22:00), morning (<07:00), weekend (Sat/Sun) activity
  const [special] = await db.execute<{ night: number, morning: number, weekend: number }>(sql`
    SELECT
      COUNT(*) FILTER (WHERE EXTRACT(HOUR FROM created_at) >= 22)::int AS night,
      COUNT(*) FILTER (WHERE EXTRACT(HOUR FROM created_at) < 7)::int AS morning,
      COUNT(*) FILTER (WHERE EXTRACT(DOW FROM created_at) IN (0, 6))::int AS weekend
    FROM activity_log
    WHERE organization_id = ${orgId} AND actor_id = ${userId}
  `)

  return {
    vacanciesClosed: vacClosed?.cnt ?? 0,
    offersMade,
    offersAccepted,
    interviews,
    candidatesScreened,
    offerAcceptRate,
    activityStreak: streak?.streak ?? 0,
    fastestHireDays: fastHire?.days ?? null,
    nightActivity: special?.night ?? 0,
    morningActivity: special?.morning ?? 0,
    weekendActivity: special?.weekend ?? 0,
  }
}
