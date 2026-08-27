import { eq, and, ne } from 'drizzle-orm'
import { company } from '../../database/schema'
import { updateCompanySchema } from '../../utils/schemas/orgStructure'

/**
 * PATCH /api/companies/:id — обновление компании (юрлица).
 * Правила:
 *  - isDefault=true переносит флаг с прежней компании транзакцией;
 *  - снять isDefault напрямую нельзя — нужно назначить другую компанию по умолчанию;
 *  - архивировать компанию по умолчанию нельзя.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { company: ['update'] })
  const orgId = session.session.activeOrganizationId
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Не указан id компании' })

  const body = await readValidatedBody(event, updateCompanySchema.parse)

  const existing = await db.query.company.findFirst({
    where: and(eq(company.id, id), eq(company.organizationId, orgId)),
  })
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Компания не найдена' })

  if (body.isDefault === false && existing.isDefault) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Нельзя снять флаг «по умолчанию» — назначьте другую компанию по умолчанию',
    })
  }

  if (body.isArchived === true && (existing.isDefault || body.isDefault === true)) {
    throw createError({ statusCode: 400, statusMessage: 'Нельзя архивировать компанию по умолчанию' })
  }

  const updated = await db.transaction(async (tx) => {
    if (body.isDefault === true && !existing.isDefault) {
      await tx.update(company)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(and(eq(company.organizationId, orgId), eq(company.isDefault, true), ne(company.id, id)))
    }

    const [row] = await tx.update(company)
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.legalName !== undefined ? { legalName: body.legalName } : {}),
        ...(body.inn !== undefined ? { inn: body.inn } : {}),
        ...(body.logoUrl !== undefined ? { logoUrl: body.logoUrl } : {}),
        ...(body.isDefault !== undefined ? { isDefault: body.isDefault } : {}),
        ...(body.isArchived !== undefined ? { isArchived: body.isArchived } : {}),
        ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(company.id, id), eq(company.organizationId, orgId)))
      .returning()

    return row
  })

  if (!updated) throw createError({ statusCode: 500, statusMessage: 'Не удалось обновить компанию' })

  recordActivity({
    organizationId: orgId,
    actorId: session.user.id,
    action: 'updated',
    resourceType: 'company',
    resourceId: updated.id,
    metadata: { name: updated.name },
  })

  return updated
})
