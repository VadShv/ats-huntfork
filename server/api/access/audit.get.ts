import { z } from 'zod'
import { and, desc, eq, gte, lte, type SQL } from 'drizzle-orm'
import { activityLog } from '../../database/schema/app'
import { user } from '../../database/schema/auth'

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  actorId: z.string().optional(),
  action: z.string().optional(),
  resourceType: z.string().optional(),
  decision: z.enum(['allow', 'deny']).optional(),
  minRisk: z.coerce.number().int().min(0).max(2).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
})

/**
 * GET /api/access/audit
 * The audit journal (RBAC v2 §7/§8.8) with filters. Owner/admin only
 * (member:update). Returns audit v2 fields incl. before/after, ip, decision,
 * risk, and hash-chain markers.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { member: ['update'] })
  const orgId = session.session.activeOrganizationId
  const q = await getValidatedQuery(event, querySchema.parse)

  const conds: SQL[] = [eq(activityLog.organizationId, orgId)]
  if (q.actorId) conds.push(eq(activityLog.actorId, q.actorId))
  if (q.action) conds.push(eq(activityLog.action, q.action as typeof activityLog.$inferSelect.action))
  if (q.resourceType) conds.push(eq(activityLog.resourceType, q.resourceType))
  if (q.decision) conds.push(eq(activityLog.decision, q.decision))
  if (q.minRisk != null) conds.push(gte(activityLog.riskLevel, q.minRisk))
  if (q.from) conds.push(gte(activityLog.createdAt, new Date(q.from)))
  if (q.to) conds.push(lte(activityLog.createdAt, new Date(q.to)))

  const where = and(...conds)
  const offset = (q.page - 1) * q.limit

  const rows = await db
    .select({
      id: activityLog.id,
      actorId: activityLog.actorId,
      actorName: user.name,
      actorEmail: activityLog.actorEmail,
      action: activityLog.action,
      resourceType: activityLog.resourceType,
      resourceId: activityLog.resourceId,
      metadata: activityLog.metadata,
      before: activityLog.before,
      after: activityLog.after,
      ip: activityLog.ip,
      decision: activityLog.decision,
      policyReason: activityLog.policyReason,
      riskLevel: activityLog.riskLevel,
      fieldSet: activityLog.fieldSet,
      hasHash: activityLog.entryHash,
      createdAt: activityLog.createdAt,
    })
    .from(activityLog)
    .leftJoin(user, eq(user.id, activityLog.actorId))
    .where(where)
    .orderBy(desc(activityLog.createdAt))
    .limit(q.limit)
    .offset(offset)

  const total = await db.$count(activityLog, where)

  return {
    data: rows.map((r) => ({ ...r, chained: !!r.hasHash, hasHash: undefined })),
    total,
    page: q.page,
    limit: q.limit,
  }
})
