/**
 * GET /api/hh/auto-respond/log
 *
 * List auto-respond execution logs for the current org, newest first.
 * Optional ruleId filter, pagination via limit/offset.
 * LEFT JOIN application → candidate for candidate name.
 */
import { and, desc, eq, type SQL } from 'drizzle-orm'
import {
  hhAutoRespondLog,
  application,
  candidate,
} from '../../../../database/schema'

export default defineEventHandler(async (event) => {
  const { session } = await requirePermission(event, { hhAutoRespond: ['read'] })
  const orgId = session.activeOrganizationId

  const query = getQuery(event)
  const ruleId = typeof query.ruleId === 'string' && query.ruleId ? query.ruleId : undefined
  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200)
  const offset = Math.max(Number(query.offset) || 0, 0)

  const conds: SQL[] = [eq(hhAutoRespondLog.organizationId, orgId)]
  if (ruleId) conds.push(eq(hhAutoRespondLog.ruleId, ruleId))
  const where = and(...conds)

  const rows = await db
    .select({
      id: hhAutoRespondLog.id,
      ruleId: hhAutoRespondLog.ruleId,
      applicationId: hhAutoRespondLog.applicationId,
      negotiationId: hhAutoRespondLog.negotiationId,
      hhAccountId: hhAutoRespondLog.hhAccountId,
      status: hhAutoRespondLog.status,
      messagePreview: hhAutoRespondLog.messagePreview,
      error: hhAutoRespondLog.error,
      createdAt: hhAutoRespondLog.createdAt,
      candidateFirstName: candidate.firstName,
      candidateLastName: candidate.lastName,
    })
    .from(hhAutoRespondLog)
    .leftJoin(application, eq(application.id, hhAutoRespondLog.applicationId))
    .leftJoin(candidate, eq(candidate.id, application.candidateId))
    .where(where)
    .orderBy(desc(hhAutoRespondLog.createdAt))
    .limit(limit)
    .offset(offset)

  const total = await db.$count(hhAutoRespondLog, where)

  return {
    items: rows,
    total,
  }
})
