import { sql, type SQL } from 'drizzle-orm'

/**
 * Центр аналитики: общий порог «застрявших» кандидатов (Блок C1).
 *
 * Кандидат «застрял», если открытый working-визит длится дольше порога:
 *   порог = pipeline_stage.sla_days, если задан; иначе p90 длительности
 *   этого root-этапа за последние 90 дней.
 *
 * Возвращает SQL-условие для WHERE поверх mv (alias 'v'), сопоставленного с
 * CTE p90_by_root (см. slaP90Cte). Использовать вместе как:
 *   WITH ${slaP90Cte(orgId)} SELECT ... WHERE ${stuckCondition('v')}
 */

/** CTE, вычисляющий p90 длительности (в днях) по каждому root-этапу за 90 дней. */
export function slaP90Cte(orgId: string): SQL {
  return sql`p90_by_root AS (
    SELECT v2.root_stage_id,
      percentile_cont(0.9) WITHIN GROUP (ORDER BY v2.duration_hours) / 24.0 AS p90_days
    FROM mv_application_stage_durations v2
    WHERE v2.organization_id = ${orgId}
      AND v2.duration_hours IS NOT NULL
      AND v2.exited_at >= now() - interval '90 days'
    GROUP BY v2.root_stage_id
  )`
}

/**
 * Условие «застрял»: открытый working-визит дольше порога SLA/p90.
 * Требует JOIN к pipeline_stage (alias 'rs') по root_stage_id и
 * LEFT JOIN к p90_by_root (alias 'p'). alias — alias строки mv (обычно 'v').
 */
export function stuckCondition(alias: string): SQL {
  const a = sql.raw(alias)
  return sql`${a}.exited_at IS NULL
    AND ${a}.bucket = 'working'
    AND COALESCE(rs.sla_days::numeric, p.p90_days) IS NOT NULL
    AND (EXTRACT(EPOCH FROM (now() - ${a}.entered_at)) / 86400.0) >= COALESCE(rs.sla_days::numeric, p.p90_days)`
}
