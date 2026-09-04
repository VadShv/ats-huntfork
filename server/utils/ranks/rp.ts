/**
 * Rank Points (RP) — competitive, quality-forward rating computed from data.
 * RP = Σ(result_points × gradeMult) × qualityFactor × speedFactor.
 *
 * Only manual recruiter moves (moved_by_user_id) count — AI auto-moves excluded.
 * Grade-weighted per event; quality (acceptance) and speed (first-response) as multipliers.
 */
import { sql } from 'drizzle-orm'
import { db } from '../db'
import { GAMIFICATION_CONFIG, gradeMultiplierSql, rpQualityFactor, rpSpeedFactor } from '../../../shared/gamification-config'

export interface RpResult {
  rp: number
  hires: number
  offers: number
  interviews: number
  vacanciesClosed: number
  avgResponseHours: number | null
  quality: number
  speed: number
}

interface Accum {
  gradedHires: number; gradedOffers: number; gradedInterviews: number; gradedVac: number
  hires: number; offers: number; interviews: number; vacanciesClosed: number
  respSumHours: number; respCount: number
}

function empty(): Accum {
  return { gradedHires: 0, gradedOffers: 0, gradedInterviews: 0, gradedVac: 0, hires: 0, offers: 0, interviews: 0, vacanciesClosed: 0, respSumHours: 0, respCount: 0 }
}

function finalize(a: Accum): RpResult {
  const W = GAMIFICATION_CONFIG.rank.rpWeights
  const avgResponseHours = a.respCount > 0 ? a.respSumHours / a.respCount : null
  const quality = rpQualityFactor(a.hires, a.offers)
  const speed = rpSpeedFactor(avgResponseHours)
  const raw = a.gradedHires * W.hire + a.gradedOffers * W.offer + a.gradedInterviews * W.interview + a.gradedVac * W.vacancyClosed
  return {
    rp: Math.round(raw * quality * speed),
    hires: a.hires, offers: a.offers, interviews: a.interviews, vacanciesClosed: a.vacanciesClosed,
    avgResponseHours: avgResponseHours != null ? Math.round(avgResponseHours * 10) / 10 : null,
    quality, speed,
  }
}

/** Compute RP for every recruiter with activity in the window. */
export async function computeOrgRp(orgId: string, startISO: string, endISO: string): Promise<Map<string, RpResult>> {
  const gradeMul = gradeMultiplierSql('j.experience_level')
  const acc = new Map<string, Accum>()
  const get = (uid: string) => { let a = acc.get(uid); if (!a) { a = empty(); acc.set(uid, a) } return a }

  // 1. Stage moves by user + type, grade-weighted
  const stageRows = await db.execute<{ uid: string, type: string, cnt: number, graded: number }>(sql`
    SELECT ash.moved_by_user_id AS uid, ps.type AS type,
           count(*)::int AS cnt, COALESCE(sum(${sql.raw(gradeMul)}), 0)::float8 AS graded
    FROM application_stage_history ash
    JOIN pipeline_stage ps ON ps.id = ash.to_stage_id
    JOIN application a ON a.id = ash.application_id
    JOIN job j ON j.id = a.job_id
    WHERE ash.organization_id = ${orgId} AND ash.moved_by_user_id IS NOT NULL
      AND ash.moved_at >= ${startISO} AND ash.moved_at <= ${endISO}
    GROUP BY ash.moved_by_user_id, ps.type
  `)
  for (const r of stageRows as any[]) {
    const a = get(r.uid)
    const g = Number(r.graded), c = Number(r.cnt)
    if (r.type === 'hired') { a.gradedHires += g; a.hires += c }
    else if (r.type === 'offer') { a.gradedOffers += g; a.offers += c }
    else if (r.type === 'interview') { a.gradedInterviews += g; a.interviews += c }
  }

  // 2. Vacancies closed by user, grade-weighted
  const vacRows = await db.execute<{ uid: string, cnt: number, graded: number }>(sql`
    SELECT al.actor_id AS uid, count(*)::int AS cnt,
           COALESCE(sum(${sql.raw(gradeMultiplierSql('j.experience_level'))}), 0)::float8 AS graded
    FROM activity_log al
    JOIN job j ON j.id = al.resource_id
    WHERE al.organization_id = ${orgId} AND al.actor_id IS NOT NULL
      AND al.action = 'status_changed' AND al.resource_type = 'job' AND al.metadata->>'to' = 'closed'
      AND al.created_at >= ${startISO} AND al.created_at <= ${endISO}
    GROUP BY al.actor_id
  `)
  for (const r of vacRows as any[]) {
    const a = get(r.uid)
    a.gradedVac += Number(r.graded); a.vacanciesClosed += Number(r.cnt)
  }

  // 3. Avg time-to-first-response (hours): first recruiter move to contact/screening per application
  const respRows = await db.execute<{ uid: string, avg_h: number, n: number }>(sql`
    WITH firsts AS (
      SELECT DISTINCT ON (ash.application_id)
        ash.moved_by_user_id AS uid,
        extract(epoch from (ash.moved_at - a.created_at)) / 3600.0 AS hours
      FROM application_stage_history ash
      JOIN application a ON a.id = ash.application_id
      JOIN pipeline_stage ps ON ps.id = ash.to_stage_id
      WHERE ash.organization_id = ${orgId} AND ash.moved_by_user_id IS NOT NULL
        AND ps.type IN ('contact','screening')
        AND ash.moved_at >= ${startISO} AND ash.moved_at <= ${endISO}
      ORDER BY ash.application_id, ash.moved_at ASC
    )
    SELECT uid, avg(hours)::float8 AS avg_h, count(*)::int AS n
    FROM firsts WHERE hours >= 0 GROUP BY uid
  `)
  for (const r of respRows as any[]) {
    const a = get(r.uid)
    a.respSumHours += Number(r.avg_h) * Number(r.n); a.respCount += Number(r.n)
  }

  const out = new Map<string, RpResult>()
  for (const [uid, a] of acc) out.set(uid, finalize(a))
  return out
}

export async function computeUserRp(userId: string, orgId: string, startISO: string, endISO: string): Promise<RpResult> {
  const map = await computeOrgRp(orgId, startISO, endISO)
  return map.get(userId) ?? finalize(empty())
}
