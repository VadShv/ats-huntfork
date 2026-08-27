import { eq, and } from 'drizzle-orm'
import { company, department } from '../../database/schema'
import { createDepartmentSchema } from '../../utils/schemas/orgStructure'

/**
 * POST /api/departments — создание подразделения.
 * parentId и companyId проверяются на принадлежность организации.
 * Если companyId не передан, наследуется от родителя (удобно при
 * построении дерева юрлица сверху вниз).
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { department: ['create'] })
  const orgId = session.session.activeOrganizationId

  const body = await readValidatedBody(event, createDepartmentSchema.parse)

  let inheritedCompanyId: string | null = body.companyId ?? null

  if (body.parentId) {
    const parent = await db.query.department.findFirst({
      where: and(eq(department.id, body.parentId), eq(department.organizationId, orgId)),
    })
    if (!parent) throw createError({ statusCode: 400, statusMessage: 'Родительское подразделение не найдено' })
    if (body.companyId === undefined) inheritedCompanyId = parent.companyId
  }

  if (inheritedCompanyId) {
    const comp = await db.query.company.findFirst({
      where: and(eq(company.id, inheritedCompanyId), eq(company.organizationId, orgId)),
    })
    if (!comp) throw createError({ statusCode: 400, statusMessage: 'Компания не найдена' })
  }

  const [created] = await db.insert(department).values({
    organizationId: orgId,
    name: body.name,
    companyId: inheritedCompanyId,
    parentId: body.parentId ?? null,
    sortOrder: body.sortOrder ?? 0,
  }).returning()

  if (!created) throw createError({ statusCode: 500, statusMessage: 'Не удалось создать подразделение' })

  recordActivity({
    organizationId: orgId,
    actorId: session.user.id,
    action: 'created',
    resourceType: 'department',
    resourceId: created.id,
    metadata: { name: created.name },
  })

  setResponseStatus(event, 201)
  return created
})
