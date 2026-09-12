import { z } from 'zod'
import { and, eq, inArray } from 'drizzle-orm'
import { member } from '../../database/schema/auth'
import { company, department } from '../../database/schema/app'
import { orgScopeAssignment } from '../../database/schema/rbac'
import { syncMemberRoleChange, bumpPermissionsVersion } from '../../utils/access/memberRbacSync'
import { recordActivity } from '../../utils/recordActivity'

const bodySchema = z.object({
  targetType: z.enum(['company', 'department']),
  targetId: z.string().min(1),
  memberIds: z.array(z.string().min(1)).max(200),
})

/**
 * PUT /api/access/hrbp
 * Replace the set of HRBP members for a company or department (§1).
 * Owner/admin only (member:update). Assigning a member also gives them the
 * `hrbp` role (so their scope resolves from org_scope_assignment). Removing all
 * assignments does NOT auto-revert the role — the owner manages that in Access.
 * Bumps permissions_version for every affected member.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { member: ['update'] })
  const orgId = session.session.activeOrganizationId
  const body = await readValidatedBody(event, bodySchema.parse)

  // Validate target belongs to the org.
  if (body.targetType === 'company') {
    const [c] = await db.select({ id: company.id }).from(company)
      .where(and(eq(company.id, body.targetId), eq(company.organizationId, orgId))).limit(1)
    if (!c) throw createError({ statusCode: 404, statusMessage: 'Компания не найдена' })
  }
  else {
    const [d] = await db.select({ id: department.id }).from(department)
      .where(and(eq(department.id, body.targetId), eq(department.organizationId, orgId))).limit(1)
    if (!d) throw createError({ statusCode: 404, statusMessage: 'Департамент не найден' })
  }

  // Validate members belong to the org.
  const validMembers = body.memberIds.length > 0
    ? await db.select({ id: member.id }).from(member)
        .where(and(eq(member.organizationId, orgId), inArray(member.id, body.memberIds)))
    : []
  const validIds = new Set(validMembers.map((m) => m.id))
  const targetMemberIds = body.memberIds.filter((id) => validIds.has(id))

  const col = body.targetType === 'company' ? orgScopeAssignment.companyId : orgScopeAssignment.departmentId

  // Current assignments for this target → to compute who is affected.
  const current = await db
    .select({ memberId: orgScopeAssignment.memberId })
    .from(orgScopeAssignment)
    .where(and(eq(orgScopeAssignment.organizationId, orgId), eq(col, body.targetId)))
  const currentIds = new Set(current.map((r) => r.memberId))

  // Replace-all for this target, in a transaction.
  await db.transaction(async (tx) => {
    await tx.delete(orgScopeAssignment)
      .where(and(eq(orgScopeAssignment.organizationId, orgId), eq(col, body.targetId)))
    if (targetMemberIds.length > 0) {
      await tx.insert(orgScopeAssignment).values(targetMemberIds.map((memberId) => ({
        organizationId: orgId,
        memberId,
        companyId: body.targetType === 'company' ? body.targetId : null,
        departmentId: body.targetType === 'department' ? body.targetId : null,
        createdBy: session.user.id,
      })))
    }
  })

  // Newly-assigned members get the hrbp role (idempotent). All affected members
  // (added or removed) get a permissions_version bump.
  const affected = new Set<string>([...currentIds, ...targetMemberIds])
  for (const memberId of targetMemberIds) {
    const [m] = await db.select({ role: member.role, organizationId: member.organizationId })
      .from(member).where(eq(member.id, memberId)).limit(1)
    if (m && m.role !== 'hrbp' && m.role !== 'owner' && m.role !== 'admin') {
      await db.update(member).set({ role: 'hrbp' }).where(eq(member.id, memberId))
      await syncMemberRoleChange(memberId, orgId, 'hrbp')
      affected.delete(memberId) // syncMemberRoleChange already bumped
    }
  }
  for (const memberId of affected) {
    await bumpPermissionsVersion(memberId)
  }

  recordActivity({
    organizationId: orgId,
    actorId: session.user.id,
    action: 'updated',
    resourceType: body.targetType,
    resourceId: body.targetId,
    metadata: { event: 'hrbp_assigned', count: targetMemberIds.length },
  })

  return { ok: true, targetType: body.targetType, targetId: body.targetId, memberIds: targetMemberIds }
})
