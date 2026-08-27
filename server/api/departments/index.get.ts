import { eq, asc, sql } from 'drizzle-orm'
import { department, job } from '../../database/schema'

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

  type DepartmentNode = (typeof rows)[number] & { depth: number, hasChildren: boolean, jobsCount: number }
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
      })
      walk(node.id, depth + 1)
    }
  }
  walk(null, 0)

  return result
})
