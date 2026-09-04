/**
 * Compute recruiter metrics from existing data (no new tracking tables).
 * All metrics are derived from applicationStageHistory + activityLog.
 * Uses db.select() (drizzle query builder) for Proxy compatibility.
 */
import { sql, eq, and, count } from 'drizzle-orm'
import { db } from '../db'
import { activityLog, applicationStageHistory, pipelineStage, application } from '../../database/schema'

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
  const stageRows = await db
    .select({ type: pipelineStage.type, cnt: sql<number>`count(*)::int` })
    .from(applicationStageHistory)
    .innerJoin(pipelineStage, eq(pipelineStage.id, applicationStageHistory.toStageId))
    .where(and(
      eq(applicationStageHistory.organizationId, orgId),
      eq(applicationStageHistory.movedByUserId, userId),
    ))
    .groupBy(pipelineStage.type)

  const stageMap = new Map(stageRows.map(r => [r.type, Number(r.cnt)]))
  const offersMade = stageMap.get('offer') ?? 0
  const offersAccepted = stageMap.get('hired') ?? 0
  const interviews = stageMap.get('interview') ?? 0
  const candidatesScreened = (stageMap.get('screening') ?? 0) + (stageMap.get('assessment') ?? 0) + (stageMap.get('contact') ?? 0)
  const offerAcceptRate = offersMade >= 10 ? Math.round((offersAccepted / offersMade) * 100) : 0

  // Vacancies closed — activityLog: action='status_changed', metadata.to='closed'
  const vacRows = await db
    .select({ cnt: sql<number>`count(*)::int` })
    .from(activityLog)
    .where(and(
      eq(activityLog.organizationId, orgId),
      eq(activityLog.actorId, userId),
      eq(activityLog.action, 'status_changed'),
      eq(activityLog.resourceType, 'job'),
      sql`${activityLog.metadata}->>'to' = 'closed'`,
    ))
  const vacanciesClosed = Number(vacRows[0]?.cnt ?? 0)

  // Fastest hire — min days from application.created_at to hire stage move
  const fastRows = await db
    .select({ days: sql<number | null>`min(extract(epoch from (ash.moved_at - a.created_at)) / 86400)::int` })
    .from(applicationStageHistory)
    .innerJoin(application, eq(application.id, applicationStageHistory.applicationId))
    .innerJoin(pipelineStage, eq(pipelineStage.id, applicationStageHistory.toStageId))
    .where(and(
      eq(applicationStageHistory.organizationId, orgId),
      eq(applicationStageHistory.movedByUserId, userId),
      eq(pipelineStage.type, 'hired'),
    ))
  const fastestHireDays = fastRows[0]?.days ?? null

  // Activity streak — consecutive days with any activity by the user
  const streakRows = await db.execute<{ streak: number }>(sql`
    WITH active_days AS (
      SELECT DISTINCT DATE(created_at) AS d
      FROM activity_log
      WHERE organization_id = ${orgId} AND actor_id = ${userId}
    ),
    gaps AS (
      SELECT d, (d - (ROW_NUMBER() OVER (ORDER BY d))::int) AS grp
      FROM active_days
    )
    SELECT COALESCE(MAX(cnt), 0)::int AS streak
    FROM (SELECT grp, count(*)::int AS cnt FROM gaps GROUP BY grp) g
  `)
  const activityStreak = Number((streakRows as any[])?.[0]?.streak ?? 0)

  // Special: night (>22:00), morning (<07:00), weekend (Sat/Sun) activity
  const specialRows = await db.execute<{ night: number, morning: number, weekend: number }>(sql`
    SELECT
      count(*) FILTER (WHERE extract(hour from created_at) >= 22)::int AS night,
      count(*) FILTER (WHERE extract(hour from created_at) < 7)::int AS morning,
      count(*) FILTER (WHERE extract(dow from created_at) IN (0, 6))::int AS weekend
    FROM activity_log
    WHERE organization_id = ${orgId} AND actor_id = ${userId}
  `)
  const special = (specialRows as any[])?.[0]

  return {
    vacanciesClosed,
    offersMade,
    offersAccepted,
    interviews,
    candidatesScreened,
    offerAcceptRate,
    activityStreak,
    fastestHireDays,
    nightActivity: Number(special?.night ?? 0),
    morningActivity: Number(special?.morning ?? 0),
    weekendActivity: Number(special?.weekend ?? 0),
  }
}
