/**
 * HuntPass SXP computation — derived from existing data within the season window.
 * No SXP is stored; it is recomputed from application_stage_history + activity_log.
 *
 * - Only manual recruiter moves count (moved_by_user_id = user): AI auto-advance/
 *   auto-reject use a NULL system actor and are excluded by design.
 * - Grade multiplier: each result event is weighted by its vacancy's experience level.
 */
import { sql } from 'drizzle-orm'
import { db } from '../db'
import { GAMIFICATION_CONFIG, gradeMultiplierSql, hireQualityFactor } from '../../../shared/gamification-config'

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
  const W = GAMIFICATION_CONFIG.sxpWeights
  const gradeMul = gradeMultiplierSql('j.experience_level')

  // Manual stage moves in window, by type, with grade-weighted sum + raw count.
  const stageRows = await db.execute<{ type: string, cnt: number, graded: number }>(sql`
    SELECT ps.type AS type,
           count(*)::int AS cnt,
           COALESCE(sum(${sql.raw(gradeMul)}), 0)::float8 AS graded
    FROM application_stage_history ash
    JOIN pipeline_stage ps ON ps.id = ash.to_stage_id
    JOIN application a ON a.id = ash.application_id
    JOIN job j ON j.id = a.job_id
    WHERE ash.organization_id = ${orgId}
      AND ash.moved_by_user_id = ${userId}
      AND ash.moved_at >= ${start} AND ash.moved_at <= ${end}
    GROUP BY ps.type
  `)
  const rows = stageRows as any[]
  const raw = new Map(rows.map(r => [r.type, Number(r.cnt)]))
  const graded = new Map(rows.map(r => [r.type, Number(r.graded)]))

  const hires = raw.get('hired') ?? 0
  const offers = raw.get('offer') ?? 0
  const interviews = raw.get('interview') ?? 0

  // Vacancies closed by the recruiter in window, grade-weighted.
  const vacRows = await db.execute<{ cnt: number, graded: number }>(sql`
    SELECT count(*)::int AS cnt,
           COALESCE(sum(${sql.raw(gradeMultiplierSql('j.experience_level'))}), 0)::float8 AS graded
    FROM activity_log al
    JOIN job j ON j.id = al.resource_id
    WHERE al.organization_id = ${orgId} AND al.actor_id = ${userId}
      AND al.action = 'status_changed' AND al.resource_type = 'job'
      AND al.metadata->>'to' = 'closed'
      AND al.created_at >= ${start} AND al.created_at <= ${end}
  `)
  const vacanciesClosed = Number((vacRows as any[])[0]?.cnt ?? 0)
  const vacGraded = Number((vacRows as any[])[0]?.graded ?? 0)

  const qualityFactor = hireQualityFactor(hires, offers)
  const sxp = Math.round(
    (graded.get('hired') ?? 0) * W.hire * qualityFactor
    + (graded.get('offer') ?? 0) * W.offer
    + (graded.get('interview') ?? 0) * W.interview
    + vacGraded * W.vacancyClosed,
  )

  return { sxp, hires, offers, interviews, vacanciesClosed, qualityFactor }
}
