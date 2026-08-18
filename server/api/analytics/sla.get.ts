import { z } from 'zod'
import { sql } from 'drizzle-orm'
import { db } from '../../utils/db'
import { analyticsQuerySchema, mvFilterConditions, andAll } from '../../utils/analytics/filters'
import { analyticsRefreshState } from '../../utils/analytics/refresh-state'

const slaQuerySchema = analyticsQuerySchema.extend({
  limit: z.coerce.number().int().min(1).max(200).default(50),
})

/**
 * GET /api/analytics/sla — «Замедления сейчас» (Спринт 23, C2 + решение O3).
 *
 * Открытые визиты working-этапов, где кандидат сидит дольше порога:
 *   порог = sla_days root-этапа, если задан;
 *   иначе p90 длительности этого root-этапа за последние 90 дней (fallback).
 * thresholdSource показывает, какой порог применён ('sla' | 'p90').
 * Предупреждение (warning) — при заданном sla_alert_days. Сортировка по просрочке.
 *
 * Открытые визиты сверяются с application.current_stage_id (защита от лага mv).
 */
export default defineEventHandler(async (event) => {
  // sourceTracking:read есть у owner/admin/member, но НЕ у hiring_manager —
  // аналитика подбора недоступна НМ (как и весь /dashboard в UI)
  const session = await requirePermission(event, { application: ['read'], sourceTracking: ['read'] })
  const orgId = session.session.activeOrganizationId

  const q = await getValidatedQuery(event, slaQuerySchema.parse)
  const mvConds = mvFilterConditions('v', orgId, q)

  const rows: any = await db.execute(sql`
    WITH p90_by_root AS (
      SELECT v.root_stage_id, percentile_cont(0.9) WITHIN GROUP (ORDER BY v.duration_hours) / 24.0 AS p90_days
      FROM mv_application_stage_durations v
      WHERE v.organization_id = ${orgId}
        AND v.duration_hours IS NOT NULL
        AND v.exited_at >= now() - interval '90 days'
      GROUP BY v.root_stage_id
    ),
    open_visits AS (
      SELECT
        v.application_id, v.candidate_id, v.job_id, v.stage_id, v.root_stage_id, v.entered_at,
        EXTRACT(EPOCH FROM (now() - v.entered_at)) / 86400.0 AS days_on_stage
      FROM mv_application_stage_durations v
      JOIN application a ON a.id = v.application_id AND a.current_stage_id = v.stage_id
      WHERE ${andAll([...mvConds, sql`v.exited_at IS NULL`, sql`v.bucket = 'working'`])}
    )
    SELECT
      ov.*,
      rs.name AS root_stage_name,
      rs.color AS root_stage_color,
      rs.sla_days,
      rs.sla_alert_days,
      p.p90_days,
      COALESCE(rs.sla_days::numeric, p.p90_days) AS threshold_days,
      CASE WHEN rs.sla_days IS NOT NULL THEN 'sla' ELSE 'p90' END AS threshold_source,
      c.first_name, c.last_name,
      j.title AS job_title
    FROM open_visits ov
    JOIN pipeline_stage rs ON rs.id = ov.root_stage_id
    LEFT JOIN p90_by_root p ON p.root_stage_id = ov.root_stage_id
    JOIN candidate c ON c.id = ov.candidate_id
    JOIN job j ON j.id = ov.job_id
    WHERE COALESCE(rs.sla_days::numeric, p.p90_days) IS NOT NULL
      AND ov.days_on_stage >= COALESCE(LEAST(rs.sla_alert_days, rs.sla_days)::numeric, rs.sla_days::numeric, p.p90_days)
    ORDER BY ov.days_on_stage - COALESCE(rs.sla_days::numeric, p.p90_days) DESC
    LIMIT ${q.limit}
  `)

  return {
    refreshedAt: analyticsRefreshState.lastRefreshAt?.toISOString() ?? null,
    items: rows.map((r: any) => {
      const days = Number(r.days_on_stage)
      const threshold = r.threshold_days != null ? Number(r.threshold_days) : null
      return {
        applicationId: r.application_id,
        candidateId: r.candidate_id,
        candidateFirstName: r.first_name,
        candidateLastName: r.last_name,
        jobId: r.job_id,
        jobTitle: r.job_title,
        stageId: r.stage_id,
        rootStageId: r.root_stage_id,
        rootStageName: r.root_stage_name,
        rootStageColor: r.root_stage_color,
        enteredAt: r.entered_at,
        daysOnStage: Math.round(days * 10) / 10,
        thresholdDays: threshold != null ? Math.round(threshold * 10) / 10 : null,
        thresholdSource: r.threshold_source as 'sla' | 'p90',
        overdueDays: threshold != null ? Math.round((days - threshold) * 10) / 10 : null,
        status: threshold != null && days >= threshold ? 'overdue' as const : 'warning' as const,
      }
    }),
  }
})
