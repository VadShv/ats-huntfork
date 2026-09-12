import { and, eq, inArray, sql } from 'drizzle-orm'
import { member, user } from '../../database/schema/auth'
import { role, memberRole, memberScope, rolePermission, orgScopeAssignment } from '../../database/schema/rbac'
import { jobMember } from '../../database/schema/hm'
import { job } from '../../database/schema/app'

/**
 * GET /api/access/members
 * Members of the active org with their RBAC v2 role, scope, and an access
 * summary ("Доступ к": visible jobs count, PII visibility). Owner/admin only.
 *
 * The access summary shows admins the ACTUAL blast radius, not just a role name.
 * Counts are computed per scope type (org = all, assigned = job_member,
 * departments = subtree jobs, jobs = explicit list).
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { member: ['update'] })
  const orgId = session.session.activeOrganizationId

  // Base rows: member + user + primary role + scope.
  const rows = await db
    .select({
      memberId: member.id,
      userId: member.userId,
      status: member.status,
      revokedAt: member.revokedAt,
      legacyRole: member.role,
      hmCanViewSalary: member.hmCanViewSalary,
      userName: user.name,
      userEmail: user.email,
      userImage: user.image,
      roleId: memberRole.roleId,
      roleKey: role.key,
      roleName: role.name,
      scopeType: memberScope.scopeType,
      departmentIds: memberScope.departmentIds,
      jobIds: memberScope.jobIds,
    })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .leftJoin(memberRole, and(eq(memberRole.memberId, member.id), eq(memberRole.isPrimary, true)))
    .leftJoin(role, eq(role.id, memberRole.roleId))
    .leftJoin(memberScope, eq(memberScope.memberId, member.id))
    .where(eq(member.organizationId, orgId))
    .orderBy(user.name)

  // Total org jobs (for org-scope summary).
  const [{ total: totalJobs }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(job)
    .where(eq(job.organizationId, orgId))

  // Precompute PII capability per distinct role id.
  const roleIds = [...new Set(rows.map((r) => r.roleId).filter(Boolean) as string[])]
  const piiByRole = new Map<string, boolean>()
  if (roleIds.length > 0) {
    const perms = await db
      .select({ roleId: rolePermission.roleId, permission: rolePermission.permission })
      .from(rolePermission)
      .where(and(inArray(rolePermission.roleId, roleIds), eq(rolePermission.permission, 'candidate:read:contacts')))
    for (const p of perms) piiByRole.set(p.roleId, true)
  }

  const result = []
  for (const r of rows) {
    const roleKey = r.roleKey ?? r.legacyRole
    const scopeType = r.scopeType ?? (roleKey === 'owner' || roleKey === 'admin' ? 'org' : 'assigned')

    // Visible jobs count per scope type.
    let visibleJobs: number
    if (scopeType === 'org' || roleKey === 'owner' || roleKey === 'admin') {
      visibleJobs = totalJobs
    }
    else if (scopeType === 'jobs') {
      visibleJobs = (r.jobIds ?? []).length
    }
    else if (scopeType === 'hrbp') {
      // §1: jobs in assigned companies OR department subtrees (org_scope_assignment).
      const asg = await db
        .select({ companyId: orgScopeAssignment.companyId, departmentId: orgScopeAssignment.departmentId })
        .from(orgScopeAssignment)
        .where(and(eq(orgScopeAssignment.organizationId, orgId), eq(orgScopeAssignment.memberId, r.memberId)))
      const companyIds = asg.map((a) => a.companyId).filter((x): x is string => !!x)
      const rootDeptIds = asg.map((a) => a.departmentId).filter((x): x is string => !!x)
      if (companyIds.length === 0 && rootDeptIds.length === 0) {
        visibleJobs = 0
      }
      else {
        const sub = await db.execute<{ cnt: number }>(sql`
          WITH RECURSIVE subtree AS (
            SELECT id FROM department WHERE id = ANY(${rootDeptIds}) AND organization_id = ${orgId}
            UNION ALL
            SELECT d.id FROM department d JOIN subtree s ON d.parent_id = s.id
          )
          SELECT count(*)::int AS cnt FROM job
          WHERE organization_id = ${orgId}
            AND (company_id = ANY(${companyIds}) OR department_id IN (SELECT id FROM subtree))
        `)
        visibleJobs = Number(sub[0]?.cnt ?? 0)
      }
    }
    else if (scopeType === 'departments') {
      const roots = r.departmentIds ?? []
      if (roots.length === 0) visibleJobs = 0
      else {
        const sub = await db.execute<{ cnt: number }>(sql`
          WITH RECURSIVE subtree AS (
            SELECT id, 1 AS depth FROM department WHERE id IN ${roots} AND organization_id = ${orgId}
            UNION ALL
            SELECT d.id, s.depth + 1 FROM department d JOIN subtree s ON d.parent_id = s.id WHERE s.depth < 32
          )
          SELECT count(*)::int AS cnt FROM job WHERE organization_id = ${orgId} AND department_id IN (SELECT id FROM subtree)
        `)
        visibleJobs = Number(sub[0]?.cnt ?? 0)
      }
    }
    else {
      // assigned
      const [c] = await db
        .select({ cnt: sql<number>`count(distinct ${jobMember.jobId})::int` })
        .from(jobMember)
        .where(and(
          eq(jobMember.organizationId, orgId),
          eq(jobMember.userId, r.userId),
          inArray(jobMember.memberRole, ['recruiter', 'hiring_manager']),
        ))
      visibleJobs = Number(c?.cnt ?? 0)
    }

    result.push({
      memberId: r.memberId,
      userId: r.userId,
      name: r.userName,
      email: r.userEmail,
      image: r.userImage,
      status: r.revokedAt ? 'revoked' : r.status,
      role: { id: r.roleId, key: roleKey, name: r.roleName ?? roleKey },
      scope: {
        type: scopeType,
        departmentIds: r.departmentIds ?? [],
        jobIds: r.jobIds ?? [],
      },
      access: {
        visibleJobs,
        totalJobs,
        unrestricted: scopeType === 'org' || roleKey === 'owner' || roleKey === 'admin',
        canViewContacts: r.roleId ? piiByRole.has(r.roleId) : (roleKey === 'owner' || roleKey === 'admin'),
      },
    })
  }

  return result
})
