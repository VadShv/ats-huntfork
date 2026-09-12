import { eq, asc, sql, and, isNotNull } from 'drizzle-orm'
import { department, job } from '../../database/schema'
import { orgScopeAssignment } from '../../database/schema/rbac'
import { member, user } from '../../database/schema/auth'

/**
 * GET /api/departments — все подразделения организации.
 * Возвращает плоский список, отсортированный обходом дерева в глубину
 * (родитель → дети), с полями depth (для отступов в UI), hasChildren
 * и jobsCount (для блокировки удаления используемых узлов).
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { department: ['read'] })
  const orgId = session.session.activeOrganizationId

  const rows = await db.query.department.findMany({
    where: eq(department.organizationId, orgId),
    orderBy: [asc(department.sortOrder), asc(department.createdAt)],
  })

  const jobCounts = await db
    .select({ departmentId: job.departmentId, cnt: sql<number>`count(*)::int` })
    .from(job)
    .where(eq(job.organizationId, orgId))
    .groupBy(job.departmentId)

  const jobCountMap = new Map(jobCounts.map(r => [r.departmentId, r.cnt]))

  // §1: HRBP assignments per department → [{ memberId, userId, name }].
  const hrbpRows = await db
    .select({ departmentId: orgScopeAssignment.departmentId, memberId: orgScopeAssignment.memberId, userId: member.userId, name: user.name })
    .from(orgScopeAssignment)
    .innerJoin(member, eq(member.id, orgScopeAssignment.memberId))
    .innerJoin(user, eq(user.id, member.userId))
    .where(and(eq(orgScopeAssignment.organizationId, orgId), isNotNull(orgScopeAssignment.departmentId)))
  const hrbpMap = new Map<string, Array<{ memberId: string, userId: string, name: string }>>()
  for (const r of hrbpRows) {
    if (!r.departmentId) continue
    ;(hrbpMap.get(r.departmentId) ?? hrbpMap.set(r.departmentId, []).get(r.departmentId)!).push({ memberId: r.memberId, userId: r.userId, name: r.name })
  }

  // Обход в глубину: сохраняем сортировку внутри уровня, вычисляем depth.
  // Узлы с parentId, указывающим на чужую/несуществующую запись, считаем корневыми.
  const ids = new Set(rows.map(r => r.id))
  const childrenMap = new Map<string | null, typeof rows>()
  for (const row of rows) {
    const key = row.parentId && ids.has(row.parentId) ? row.parentId : null
    const list = childrenMap.get(key) ?? []
    list.push(row)
    childrenMap.set(key, list)
  }

  type DepartmentNode = (typeof rows)[number] & { depth: number, hasChildren: boolean, jobsCount: number, hrbps: Array<{ memberId: string, userId: string, name: string }> }
  const result: DepartmentNode[] = []
  const visited = new Set<string>()

  function walk(parentKey: string | null, depth: number) {
    for (const node of childrenMap.get(parentKey) ?? []) {
      if (visited.has(node.id)) continue // защита от циклов в данных
      visited.add(node.id)
      result.push({
        ...node,
        depth,
        hasChildren: (childrenMap.get(node.id) ?? []).length > 0,
        jobsCount: jobCountMap.get(node.id) ?? 0,
        hrbps: hrbpMap.get(node.id) ?? [],
      })
      walk(node.id, depth + 1)
    }
  }
  walk(null, 0)

  return result
})
