import { eq, asc, sql } from 'drizzle-orm'
import { company, department, job } from '../../database/schema'

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

  return companies.map(c => ({
    ...c,
    jobsCount: jobCountMap.get(c.id) ?? 0,
    departmentsCount: deptCountMap.get(c.id) ?? 0,
  }))
})
