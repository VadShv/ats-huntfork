import { eq, asc, sql, and, isNotNull } from 'drizzle-orm'
import { company, department, job } from '../../database/schema'
import { orgScopeAssignment } from '../../database/schema/rbac'
import { member, user } from '../../database/schema/auth'

/**
 * GET /api/companies — список компаний (юрлиц) организации.
 * Возвращает компании со счётчиками вакансий и подразделений
 * (для UI настроек: блокировка удаления используемых компаний).
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { company: ['read'] })
  const orgId = session.session.activeOrganizationId

  const companies = await db.query.company.findMany({
    where: eq(company.organizationId, orgId),
    orderBy: [asc(company.sortOrder), asc(company.createdAt)],
  })

  // Счётчики одним запросом на таблицу — без N+1
  const jobCounts = await db
    .select({ companyId: job.companyId, cnt: sql<number>`count(*)::int` })
    .from(job)
    .where(eq(job.organizationId, orgId))
    .groupBy(job.companyId)

  const deptCounts = await db
    .select({ companyId: department.companyId, cnt: sql<number>`count(*)::int` })
    .from(department)
    .where(eq(department.organizationId, orgId))
    .groupBy(department.companyId)

  const jobCountMap = new Map(jobCounts.map(r => [r.companyId, r.cnt]))
  const deptCountMap = new Map(deptCounts.map(r => [r.companyId, r.cnt]))

  // §1: HRBP assignments per company → [{ memberId, userId, name }].
  const hrbpRows = await db
    .select({ companyId: orgScopeAssignment.companyId, memberId: orgScopeAssignment.memberId, userId: member.userId, name: user.name })
    .from(orgScopeAssignment)
    .innerJoin(member, eq(member.id, orgScopeAssignment.memberId))
    .innerJoin(user, eq(user.id, member.userId))
    .where(and(eq(orgScopeAssignment.organizationId, orgId), isNotNull(orgScopeAssignment.companyId)))
  const hrbpMap = new Map<string, Array<{ memberId: string, userId: string, name: string }>>()
  for (const r of hrbpRows) {
    if (!r.companyId) continue
    ;(hrbpMap.get(r.companyId) ?? hrbpMap.set(r.companyId, []).get(r.companyId)!).push({ memberId: r.memberId, userId: r.userId, name: r.name })
  }

  return companies.map(c => ({
    ...c,
    jobsCount: jobCountMap.get(c.id) ?? 0,
    departmentsCount: deptCountMap.get(c.id) ?? 0,
    hrbps: hrbpMap.get(c.id) ?? [],
  }))
})
