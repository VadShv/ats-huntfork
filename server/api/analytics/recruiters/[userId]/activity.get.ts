import { z } from 'zod'
import { sql } from 'drizzle-orm'
import { db } from '../../../../utils/db'
import { analyticsQuerySchema, resolvePeriod } from '../../../../utils/analytics/filters'
import { getOrgRole } from '../../../../utils/recruiterScope'
import { assertOrgAdmin } from '../../../../utils/analytics/scope'
import { noShowRate } from '../../../../utils/analytics/aggregations'

/**
 * GET /api/analytics/recruiters/:userId/activity — отчёт активности рекрутёра (Блок A).
 * Только admin/owner. 3 блока: интервью, движения по кандидатам, эффективность.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { application: ['read'], sourceTracking: ['read'] })
  const orgId = session.session.activeOrganizationId
  const userId = getRouterParam(event, 'userId')!

  const role = await getOrgRole(orgId, session.user.id)
  assertOrgAdmin(role)

  const q = await getValidatedQuery(event, analyticsQuerySchema.parse)
  const { from, to } = resolvePeriod(q)

  const [interviewRows, typeRows, respRows, moveRows, actLogRows, commsRows, hhRows, firstRespRows, streakRows]: any[] = await Promise.all([
    // Интервью по статусу (по createdById, scheduled_at в периоде)
    db.execute(sql`
      SELECT status, count(*)::int AS cnt
      FROM interview
      WHERE organization_id = ${orgId} AND created_by_id = ${userId}
        AND scheduled_at >= ${from} AND scheduled_at < ${to}
      GROUP BY status
    `),
    // Интервью по типу
    db.execute(sql`
      SELECT type, count(*)::int AS cnt
      FROM interview
      WHERE organization_id = ${orgId} AND created_by_id = ${userId}
        AND scheduled_at >= ${from} AND scheduled_at < ${to}
      GROUP BY type
    `),
    // Ответы кандидатов на приглашения
    db.execute(sql`
      SELECT candidate_response, count(*)::int AS cnt
      FROM interview
      WHERE organization_id = ${orgId} AND created_by_id = ${userId}
        AND scheduled_at >= ${from} AND scheduled_at < ${to}
      GROUP BY candidate_response
    `),
    // Движения по этапам (из MV, moved_by = userId, исключая AI/системные)
    db.execute(sql`
      SELECT
        count(*)::int AS total_moves,
        count(*) FILTER (WHERE stage_type = 'contact')::int AS to_contact,
        count(*) FILTER (WHERE stage_type = 'screening')::int AS to_screening,
        count(*) FILTER (WHERE stage_type = 'interview')::int AS to_interview,
        count(*) FILTER (WHERE stage_type = 'offer')::int AS to_offer,
        count(*) FILTER (WHERE stage_type = 'hired')::int AS hires,
        count(*) FILTER (WHERE bucket = 'rejected')::int AS rejects
      FROM mv_application_stage_durations
      WHERE organization_id = ${orgId} AND moved_by = ${userId}
        AND entered_at >= ${from} AND entered_at < ${to}
    `),
    // Комментарии из activity_log
    db.execute(sql`
      SELECT count(*)::int AS cnt FROM activity_log
      WHERE organization_id = ${orgId} AND actor_id = ${userId}
        AND action = 'comment_added' AND created_at >= ${from} AND created_at < ${to}
    `),
    // Сообщения кандидатам (comms_message out)
    db.execute(sql`
      SELECT count(*)::int AS cnt FROM comms_message
      WHERE organization_id = ${orgId} AND direction = 'out' AND sender_user_id = ${userId}
        AND created_at >= ${from} AND created_at < ${to}
    `).catch(() => [{ cnt: 0 }]),
    // hh действия (send_message / open_contact)
    db.execute(sql`
      SELECT
        count(*) FILTER (WHERE action_type = 'send_message')::int AS messages,
        count(*) FILTER (WHERE action_type = 'open_contact')::int AS contacts
      FROM hh_action_log
      WHERE organization_id = ${orgId} AND performed_by_user_id = ${userId}
        AND created_at >= ${from} AND created_at < ${to}
    `).catch(() => [{ messages: 0, contacts: 0 }]),
    // Медиана первого ответа: от создания отклика до первого хода рекрутёра
    db.execute(sql`
      SELECT percentile_cont(0.5) WITHIN GROUP (
        ORDER BY EXTRACT(EPOCH FROM (v.entered_at - a.created_at)) / 3600.0
      ) AS median_hours
      FROM mv_application_stage_durations v
      JOIN application a ON a.id = v.application_id
      WHERE v.organization_id = ${orgId} AND v.moved_by = ${userId}
        AND v.entered_at >= ${from} AND v.entered_at < ${to}
        AND v.from_stage_id IS NULL
    `).catch(() => [{ median_hours: null }]),
    // Активные дни (distinct days с действиями)
    db.execute(sql`
      SELECT count(DISTINCT date_trunc('day', created_at))::int AS active_days
      FROM activity_log
      WHERE organization_id = ${orgId} AND actor_id = ${userId}
        AND created_at >= ${from} AND created_at < ${to}
    `),
  ])

  const byStatus = Object.fromEntries(interviewRows.map((r: any) => [r.status, r.cnt]))
  const completed = byStatus.completed ?? 0
  const noShow = byStatus.no_show ?? 0
  const byResp = Object.fromEntries(respRows.map((r: any) => [r.candidate_response, r.cnt]))
  const mv = moveRows[0] ?? {}

  return {
    period: { from, to },
    interviews: {
      scheduled: byStatus.scheduled ?? 0,
      completed,
      cancelled: byStatus.cancelled ?? 0,
      noShow,
      noShowRate: noShowRate(completed, noShow),
      accepted: byResp.accepted ?? 0,
      declined: byResp.declined ?? 0,
      byType: typeRows.map((r: any) => ({ type: r.type, count: r.cnt })),
    },
    movements: {
      totalMoves: mv.total_moves ?? 0,
      toContact: mv.to_contact ?? 0,
      toScreening: mv.to_screening ?? 0,
      toInterview: mv.to_interview ?? 0,
      toOffer: mv.to_offer ?? 0,
      hires: mv.hires ?? 0,
      rejects: mv.rejects ?? 0,
      commentsAdded: actLogRows[0]?.cnt ?? 0,
      messagesSent: (commsRows[0]?.cnt ?? 0) + (hhRows[0]?.messages ?? 0),
      contactsOpened: hhRows[0]?.contacts ?? 0,
    },
    efficiency: {
      firstResponseMedianHours: firstRespRows[0]?.median_hours != null ? Math.round(Number(firstRespRows[0].median_hours) * 10) / 10 : null,
      interviewToOfferRate: (mv.to_interview ?? 0) > 0 ? Math.round(((mv.to_offer ?? 0) / mv.to_interview) * 1000) / 1000 : null,
      activeDays: streakRows[0]?.active_days ?? 0,
    },
  }
})
