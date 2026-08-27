import { eq, and, sql } from 'drizzle-orm'
import { department, job } from '../../database/schema'

/**
 * DELETE /api/departments/:id — удаление подразделения.
 * Запрещено, если есть дочерние подразделения или ссылающиеся вакансии — 409
 * (используйте архивацию либо сначала перенесите детей/вакансии).
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { department: ['delete'] })
  const orgId = session.session.activeOrganizationId
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Не указан id подразделения' })

  const existing = await db.query.department.findFirst({
    where: and(eq(department.id, id), eq(department.organizationId, orgId)),
  })
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Подразделение не найдено' })

  const [children] = await db
    .select({ cnt: sql<number>`count(*)::int` })
    .from(department)
    .where(and(eq(department.organizationId, orgId), eq(department.parentId, id)))

  if ((children?.cnt ?? 0) > 0) {
    throw createError({
      statusCode: 409,
      statusMessage: 'У подразделения есть дочерние узлы — сначала перенесите или удалите их',
    })
  }

  const [jobsUsed] = await db
    .select({ cnt: sql<number>`count(*)::int` })
    .from(job)
    .where(and(eq(job.organizationId, orgId), eq(job.departmentId, id)))

  if ((jobsUsed?.cnt ?? 0) > 0) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Подразделение используется вакансиями — вместо удаления архивируйте его',
    })
  }

  await db.delete(department).where(and(eq(department.id, id), eq(department.organizationId, orgId)))

  recordActivity({
    organizationId: orgId,
    actorId: session.user.id,
    action: 'deleted',
    resourceType: 'department',
    resourceId: id,
    metadata: { name: existing.name },
  })

  return { success: true }
})
