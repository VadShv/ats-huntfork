import { z } from 'zod'
import { sql, type SQL } from 'drizzle-orm'

/**
 * Спринт 23 (C2): общие фильтры всех /api/analytics/* эндпоинтов.
 * ?from&to&jobId&pipelineId&recruiterId&source&compare=prev
 *
 * Период по умолчанию — последние 30 дней. compare=prev добавляет
 * сравнение с предыдущим периодом той же длительности.
 */
export const analyticsQuerySchema = z.object({
  from: z.string().datetime({ offset: true }).optional()
    .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),
  to: z.string().datetime({ offset: true }).optional()
    .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),
  jobId: z.string().min(1).optional(),
  pipelineId: z.string().min(1).optional(),
  recruiterId: z.string().min(1).optional(),
  source: z.string().min(1).optional(),
  compare: z.enum(['prev']).optional(),
})

export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>

export interface AnalyticsPeriod {
  from: Date
  to: Date
  /** Предыдущий период той же длительности (для compare=prev) */
  prevFrom: Date
  prevTo: Date
}

const DEFAULT_PERIOD_DAYS = 30

/** Нормализованный период: [from, to] + предыдущее окно той же длительности. */
export function resolvePeriod(q: AnalyticsQuery): AnalyticsPeriod {
  const to = q.to ? endOfDayIfDateOnly(q.to) : new Date()
  const from = q.from
    ? new Date(q.from)
    : new Date(to.getTime() - DEFAULT_PERIOD_DAYS * 24 * 3600 * 1000)
  const spanMs = Math.max(to.getTime() - from.getTime(), 1)
  return {
    from,
    to,
    prevFrom: new Date(from.getTime() - spanMs),
    prevTo: new Date(from.getTime()),
  }
}

/** Дата без времени трактуется как конец дня (включительно). */
function endOfDayIfDateOnly(value: string): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(`${value}T23:59:59.999Z`)
  return new Date(value)
}

/**
 * Общие WHERE-условия для строк mv (alias обязателен, обычно `v`).
 * Период НЕ включается — каждый эндпоинт сам решает, к какой колонке
 * времени его применять (entered_at / exited_at / открытые визиты).
 */
export function mvFilterConditions(alias: string, orgId: string, q: AnalyticsQuery): SQL[] {
  const a = sql.raw(alias)
  const conds: SQL[] = [sql`${a}.organization_id = ${orgId}`]
  if (q.jobId) conds.push(sql`${a}.job_id = ${q.jobId}`)
  if (q.pipelineId) conds.push(sql`${a}.pipeline_id = ${q.pipelineId}`)
  if (q.source) conds.push(sql`${a}.source = ${q.source}`)
  if (q.recruiterId) {
    conds.push(sql`${a}.job_id IN (
      SELECT jm.job_id FROM job_member jm
      WHERE jm.user_id = ${q.recruiterId} AND jm.member_role = 'recruiter'
    )`)
  }
  return conds
}

/** Склейка условий в единый WHERE-фрагмент. */
export function andAll(conds: SQL[]): SQL {
  return sql.join(conds, sql` AND `)
}
