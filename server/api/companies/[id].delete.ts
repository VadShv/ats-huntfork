import { eq, and, sql } from 'drizzle-orm'
import { company, department, job } from '../../database/schema'

/**
 * DELETE /api/companies/:id — удаление компании (юрлица).
 * Запрещено, если компания по умолчанию либо на неё ссылаются
 * вакансии или подразделения — в этом случае 409 (используйте архивацию).
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { company: ['delete'] })
  const orgId = session.session.activeOrganizationId
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Не указан id компании' })

  const existing = await db.query.company.findFirst({
    where: and(eq(company.id, id), eq(company.organizationId, orgId)),
  })
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Компания не найдена' })

  if (existing.isDefault) {
    throw createError({ statusCode: 409, statusMessage: 'Нельзя удалить компанию по умолчанию' })
  }

  const [jobsUsed] = await db
    .select({ cnt: sql<number>`count(*)::int` })
    .from(job)
    .where(and(eq(job.organizationId, orgId), eq(job.companyId, id)))

  const [deptsUsed] = await db
    .select({ cnt: sql<number>`count(*)::int` })
    .from(department)
    .where(and(eq(department.organizationId, orgId), eq(department.companyId, id)))

  if ((jobsUsed?.cnt ?? 0) > 0 || (deptsUsed?.cnt ?? 0) > 0) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Компания используется вакансиями или подразделениями — вместо удаления архивируйте её',
    })
  }

  await db.delete(company).where(and(eq(company.id, id), eq(company.organizationId, orgId)))

  recordActivity({
    organizationId: orgId,
    actorId: session.user.id,
    action: 'deleted',
    resourceType: 'company',
    resourceId: id,
    metadata: { name: existing.name },
  })

  return { success: true }
})
