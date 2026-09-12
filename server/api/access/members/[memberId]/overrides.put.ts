import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { member } from '../../../../database/schema/auth'
import { memberPermissionOverride, permission as permissionTable } from '../../../../database/schema/rbac'
import { bumpPermissionsVersion } from '../../../../utils/access/memberRbacSync'
import { recordActivity } from '../../../../utils/recordActivity'

const paramsSchema = z.object({ memberId: z.string().min(1) })
const bodySchema = z.object({
  overrides: z.array(z.object({
    permission: z.string().min(1),
    effect: z.enum(['allow', 'deny']),
    reason: z.string().max(500).optional(),
    expiresAt: z.string().datetime().optional(),
  })).max(300),
})

/**
 * PUT /api/access/members/:memberId/overrides
 * Replace the member's per-user overrides with the provided set. deny wins over
 * role at resolve time. Validates permission keys against the catalog. Bumps
 * permissions_version. Owner/admin only.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { member: ['update'] })
  const orgId = session.session.activeOrganizationId
  const { memberId } = await getValidatedRouterParams(event, paramsSchema.parse)
  const body = await readValidatedBody(event, bodySchema.parse)

  const [target] = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.id, memberId), eq(member.organizationId, orgId)))
    .limit(1)
  if (!target) {
    throw createError({ statusCode: 404, statusMessage: 'Участник не найден' })
  }

  // Validate permission keys exist in the catalog.
  const validKeys = new Set((await db.select({ key: permissionTable.key }).from(permissionTable)).map((r) => r.key))
  for (const o of body.overrides) {
    if (!validKeys.has(o.permission)) {
      throw createError({ statusCode: 400, statusMessage: `Неизвестное право: ${o.permission}` })
    }
  }

  // Replace-all in a transaction.
  await db.transaction(async (tx) => {
    await tx.delete(memberPermissionOverride).where(eq(memberPermissionOverride.memberId, memberId))
    if (body.overrides.length > 0) {
      await tx.insert(memberPermissionOverride).values(body.overrides.map((o) => ({
        memberId,
        organizationId: orgId,
        permission: o.permission,
        effect: o.effect,
        reason: o.reason ?? null,
        expiresAt: o.expiresAt ? new Date(o.expiresAt) : null,
        createdBy: session.user.id,
      })))
    }
  })

  await bumpPermissionsVersion(memberId)

  recordActivity({
    organizationId: orgId,
    actorId: session.user.id,
    action: 'updated',
    resourceType: 'member',
    resourceId: memberId,
    metadata: { field: 'overrides', count: body.overrides.length },
  })

  return { ok: true, memberId, count: body.overrides.length }
})
