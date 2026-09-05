import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { getOrCreateCurrentSeason, quarterBounds } from '../../utils/huntpass/season'
import { computeUserRp } from '../../utils/ranks/rp'

/**
 * GET /api/metrics/summary?period=all|season
 *
 * Персональная сводка рекрутера (текущий пользователь):
 *  • openVacancies      — вакансий в работе, где пользователь = ОСНОВНОЙ рекрутер
 *                         (status='open'); состояние «сейчас», не зависит от периода.
 *  • closedVacancies    — закрыто вакансий за период (его действия).
 *  • offers             — сделано офферов за период (переводы в стадию offer).
 *  • avgCloseDays       — средний срок закрытия вакансии (дни) за период.
 *  • interviewsPerWeek  — среднее число интервью в неделю за период.
 *
 * Источник наймов/офферов/интервью/закрытий — общий с рангом (computeUserRp),
 * поэтому цифры консистентны с виджетом ранга. AI-авто-действия исключены.
 */
const querySchema = z.object({
  period: z.enum(['all', 'season']).default('season'),
})

const EPOCH_ISO = '1970-01-01T00:00:00.000Z'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const orgId = session.session.activeOrganizationId
  if (!orgId) throw createError({ statusCode: 403, statusMessage: 'Нет активной организации' })
  const userId = session.user.id

  const { period } = await getValidatedQuery(event, querySchema.parse)

  // ── Окно периода ──
  const now = new Date()
  let startISO: string
  const endISO = now.toISOString()
  let seasonName: string | null = null
  if (period === 'season') {
    const s = await getOrCreateCurrentSeason(now)
    startISO = s.startsAt.toISOString()
    seasonName = s.name
  }
  else {
    startISO = EPOCH_ISO
  }

  // ── Метрики наймов/офферов/интервью/закрытий из общего расчёта ранга ──
  const rp = await computeUserRp(userId, orgId, startISO, endISO)

  // ── Вакансий в работе, где пользователь — ОСНОВНОЙ рекрутер ──
  const openRows = await db.execute<{ cnt: number }>(sql`
    SELECT count(*)::int AS cnt
    FROM job j
    JOIN job_member jm ON jm.job_id = j.id
    WHERE j.organization_id = ${orgId}
      AND j.status = 'open'
      AND jm.user_id = ${userId}
      AND jm.member_role = 'recruiter'
      AND jm.is_primary = true
  `)
  const openVacancies = Number((openRows as any[])[0]?.cnt ?? 0)

  // ── Средний срок закрытия вакансии (дни) за период: closed_at (activity_log) − job.created_at ──
  const closeRows = await db.execute<{ avg_days: number | null }>(sql`
    SELECT avg(extract(epoch from (al.created_at - j.created_at)) / 86400.0)::float8 AS avg_days
    FROM activity_log al
    JOIN job j ON j.id = al.resource_id
    WHERE al.organization_id = ${orgId}
      AND al.actor_id = ${userId}
      AND al.action = 'status_changed'
      AND al.resource_type = 'job'
      AND al.metadata->>'to' = 'closed'
      AND al.created_at >= ${startISO} AND al.created_at <= ${endISO}
      AND al.created_at >= j.created_at
  `)
  const rawAvgDays = (closeRows as any[])[0]?.avg_days
  const avgCloseDays = rawAvgDays != null ? Math.round(Number(rawAvgDays) * 10) / 10 : null

  // ── Интервью в неделю: interviews за период / число недель окна ──
  let interviewsPerWeek: number | null = null
  if (period === 'season') {
    const { startsAt } = quarterBounds(now)
    const weeks = Math.max(1, (now.getTime() - startsAt.getTime()) / (7 * 86_400_000))
    interviewsPerWeek = Math.round((rp.interviews / weeks) * 10) / 10
  }
  else {
    // «Всё время»: окно = от первого интервью пользователя до сейчас.
    const firstRows = await db.execute<{ first_at: string | null }>(sql`
      SELECT min(ash.moved_at) AS first_at
      FROM application_stage_history ash
      JOIN pipeline_stage ps ON ps.id = ash.to_stage_id
      WHERE ash.organization_id = ${orgId}
        AND ash.moved_by_user_id = ${userId}
        AND ps.type = 'interview'
    `)
    const firstAt = (firstRows as any[])[0]?.first_at
    if (firstAt && rp.interviews > 0) {
      const weeks = Math.max(1, (now.getTime() - new Date(firstAt).getTime()) / (7 * 86_400_000))
      interviewsPerWeek = Math.round((rp.interviews / weeks) * 10) / 10
    }
    else {
      interviewsPerWeek = rp.interviews > 0 ? rp.interviews : 0
    }
  }

  return {
    period,
    seasonName,
    openVacancies,
    closedVacancies: rp.vacanciesClosed,
    offers: rp.offers,
    avgCloseDays,
    interviewsPerWeek,
  }
})
