import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { member } from '../../../../database/schema/auth'
import { memberScope } from '../../../../database/schema/rbac'
import { bumpPermissionsVersion } from '../../../../utils/access/memberRbacSync'
import { recordActivity } from '../../../../utils/recordActivity'

const paramsSchema = z.object({ memberId: z.string().min(1) })
const bodySchema = z.object({
  scopeType: z.enum(['org', 'departments', 'jobs', 'assigned', 'own']),
  departmentIds: z.array(z.string()).max(500).default([]),
  jobIds: z.array(z.string()).max(2000).default([]),
})

/**
 * PUT /api/access/members/:memberId/scope
 * Set a member's data scope (boundaries). Bumps permissions_version to
 * invalidate caches (≤ TTL). Owner/admin only.
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

  await db
    .insert(memberScope)
    .values({
      memberId,
      organizationId: orgId,
      scopeType: body.scopeType,
      departmentIds: body.scopeType === 'departments' ? body.departmentIds : [],
      jobIds: body.scopeType === 'jobs' ? body.jobIds : [],
      updatedBy: session.user.id,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: memberScope.memberId,
      set: {
        scopeType: body.scopeType,
        departmentIds: body.scopeType === 'departments' ? body.departmentIds : [],
        jobIds: body.scopeType === 'jobs' ? body.jobIds : [],
        updatedBy: session.user.id,
        updatedAt: new Date(),
      },
    })

  await bumpPermissionsVersion(memberId)

  recordActivity({
    organizationId: orgId,
    actorId: session.user.id,
    action: 'updated',
    resourceType: 'member',
    resourceId: memberId,
    metadata: { field: 'scope', scopeType: body.scopeType },
  })

  return { ok: true, memberId, scopeType: body.scopeType }
})
