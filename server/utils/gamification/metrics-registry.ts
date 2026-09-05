/**
 * Extensible windowed-metric registry for gamification (quests, seasonal, etc.).
 *
 * Each metric is a named function: (userId, orgId, start, end) => count.
 * Adding a new criterion = register a new metric here and reference its key.
 *
 * Design guarantees:
 *  - Only MANUAL recruiter actions count (moved_by_user_id = user). AI
 *    auto-advance/auto-reject use a NULL system actor → excluded by design.
 *  - HM-review stages (preset_key in excludedPresetKeys) are excluded from
 *    hygiene metrics so a slow hiring manager never penalises the recruiter.
 */
import { sql } from 'drizzle-orm'
import { db } from '../db'
import { GAMIFICATION_CONFIG } from '../../../shared/gamification-config'

type MetricFn = (userId: string, orgId: string, start: string, end: string) => Promise<number>

async function scalar(q: any): Promise<number> {
  const rows = (await q) as any[]
  return Number(rows[0]?.n ?? 0)
}

const excludedKeys = GAMIFICATION_CONFIG.excludedPresetKeys
const SLA = GAMIFICATION_CONFIG.responseSlaHours

/** Count recruiter moves whose target stage type is in `types`. */
function movesToTypes(types: string[]): MetricFn {
  const list = sql.raw(types.map(t => `'${t}'`).join(','))
  return (userId, orgId, start, end) => scalar(db.execute(sql`
    SELECT count(*)::int AS n
    FROM application_stage_history ash
    JOIN pipeline_stage ps ON ps.id = ash.to_stage_id
    WHERE ash.organization_id = ${orgId} AND ash.moved_by_user_id = ${userId}
      AND ash.moved_at >= ${start} AND ash.moved_at <= ${end}
      AND ps.type IN (${list})
  `))
}

export const METRIC_REGISTRY: Record<string, MetricFn> = {
  // ── Throughput ──
  manual_moves: (u, o, s, e) => scalar(db.execute(sql`
    SELECT count(*)::int AS n FROM application_stage_history ash
    WHERE ash.organization_id = ${o} AND ash.moved_by_user_id = ${u}
      AND ash.from_stage_id IS NOT NULL
      AND ash.moved_at >= ${s} AND ash.moved_at <= ${e}
  `)),
  moves_to_contact: movesToTypes(['contact', 'screening']),
  moves_to_interview: movesToTypes(['interview']),
  moves_to_offer: movesToTypes(['offer']),
  hires: movesToTypes(['hired']),

  // ── Responsiveness (leading indicator, fully in recruiter control) ──
  fast_first_response: (u, o, s, e) => scalar(db.execute(sql`
    SELECT count(DISTINCT ash.application_id)::int AS n
    FROM application_stage_history ash
    JOIN application a ON a.id = ash.application_id
    JOIN pipeline_stage ps ON ps.id = ash.to_stage_id
    WHERE ash.organization_id = ${o} AND ash.moved_by_user_id = ${u}
      AND ps.type IN ('contact','screening')
      AND ash.moved_at >= ${s} AND ash.moved_at <= ${e}
      AND ash.moved_at <= a.created_at + (${SLA} || ' hours')::interval
  `)),

  // ── Quality ──
  manual_review_handled: (u, o, s, e) => scalar(db.execute(sql`
    SELECT count(*)::int AS n
    FROM application_stage_history ash
    JOIN application a ON a.id = ash.application_id
    WHERE ash.organization_id = ${o} AND ash.moved_by_user_id = ${u}
      AND a.needs_manual_review = true
      AND ash.moved_at >= ${s} AND ash.moved_at <= ${e}
  `)),
  reject_with_reason: (u, o, s, e) => scalar(db.execute(sql`
    SELECT count(*)::int AS n
    FROM application_stage_history ash
    JOIN pipeline_stage ps ON ps.id = ash.to_stage_id
    WHERE ash.organization_id = ${o} AND ash.moved_by_user_id = ${u}
      AND ps.bucket = 'rejected'
      AND ash.comment IS NOT NULL AND length(trim(ash.comment)) > 0
      AND ash.moved_at >= ${s} AND ash.moved_at <= ${e}
  `)),

  // ── Progression ──
  vacancies_closed: (u, o, s, e) => scalar(db.execute(sql`
    SELECT count(*)::int AS n FROM activity_log
    WHERE organization_id = ${o} AND actor_id = ${u}
      AND action = 'status_changed' AND resource_type = 'job'
      AND metadata->>'to' = 'closed'
      AND created_at >= ${s} AND created_at <= ${e}
  `)),

  // ── Collaboration (G1) ──
  assists: (u, o, s, e) => scalar(db.execute(sql`
    SELECT count(*)::int AS n FROM referral
    WHERE organization_id = ${o} AND from_user_id = ${u} AND status = 'hired'
      AND resolved_at >= ${s} AND resolved_at <= ${e}
  `)),
}

/** Count candidates currently stuck (state metric, excludes HM-review). */
export async function stuckCandidates(userId: string, orgId: string): Promise<number> {
  const days = GAMIFICATION_CONFIG.stuckDaysThreshold
  const excl = excludedKeys.length
    ? sql.raw(`AND (ps.preset_key IS NULL OR ps.preset_key NOT IN (${excludedKeys.map(k => `'${k}'`).join(',')}))`)
    : sql.raw('')
  const rows = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n
    FROM application a
    JOIN pipeline_stage ps ON ps.id = a.current_stage_id
    JOIN job j ON j.id = a.job_id
    WHERE a.organization_id = ${orgId}
      AND ps.bucket = 'working'
      ${excl}
      AND a.stage_changed_at IS NOT NULL
      AND a.stage_changed_at < now() - (${days} || ' days')::interval
  `)
  return Number((rows as any[])[0]?.n ?? 0)
}

export async function computeMetric(key: string, userId: string, orgId: string, start: string, end: string): Promise<number> {
  const fn = METRIC_REGISTRY[key]
  if (!fn) return 0
  return fn(userId, orgId, start, end)
}
