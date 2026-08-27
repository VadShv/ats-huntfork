import { eq, and } from 'drizzle-orm'
import { company, department } from '../../database/schema'
import { updateDepartmentSchema } from '../../utils/schemas/orgStructure'

/**
 * PATCH /api/departments/:id — обновление подразделения.
 * При смене parentId проверяется принадлежность организации и отсутствие цикла
 * (нельзя подвесить узел под самого себя или под собственного потомка).
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { department: ['update'] })
  const orgId = session.session.activeOrganizationId
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Не указан id подразделения' })

  const body = await readValidatedBody(event, updateDepartmentSchema.parse)

  const existing = await db.query.department.findFirst({
    where: and(eq(department.id, id), eq(department.organizationId, orgId)),
  })
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Подразделение не найдено' })

  if (body.parentId !== undefined && body.parentId !== null) {
    if (body.parentId === id) {
      throw createError({ statusCode: 400, statusMessage: 'Подразделение не может быть родителем самого себя' })
    }

    const all = await db.query.department.findMany({
      where: eq(department.organizationId, orgId),
      columns: { id: true, parentId: true },
    })
    const parentMap = new Map(all.map(d => [d.id, d.parentId]))
    if (!parentMap.has(body.parentId)) {
      throw createError({ statusCode: 400, statusMessage: 'Родительское подразделение не найдено' })
    }

    // Поднимаемся от нового родителя к корню: если встретим текущий узел — это цикл
    let cursor: string | null | undefined = body.parentId
    const guard = new Set<string>()
    while (cursor) {
      if (cursor === id) {
        throw createError({ statusCode: 400, statusMessage: 'Нельзя перенести подразделение внутрь его собственной ветки' })
      }
      if (guard.has(cursor)) break // существующий цикл в данных — не зацикливаемся
      guard.add(cursor)
      cursor = parentMap.get(cursor)
    }
  }

  if (body.companyId !== undefined && body.companyId !== null) {
    const comp = await db.query.company.findFirst({
      where: and(eq(company.id, body.companyId), eq(company.organizationId, orgId)),
    })
    if (!comp) throw createError({ statusCode: 400, statusMessage: 'Компания не найдена' })
  }

  const [updated] = await db.update(department)
    .set({
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.companyId !== undefined ? { companyId: body.companyId } : {}),
      ...(body.parentId !== undefined ? { parentId: body.parentId } : {}),
      ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
      ...(body.isArchived !== undefined ? { isArchived: body.isArchived } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(department.id, id), eq(department.organizationId, orgId)))
    .returning()

  if (!updated) throw createError({ statusCode: 500, statusMessage: 'Не удалось обновить подразделение' })

  recordActivity({
    organizationId: orgId,
    actorId: session.user.id,
    action: 'updated',
    resourceType: 'department',
    resourceId: updated.id,
    metadata: { name: updated.name },
  })

  return updated
})
