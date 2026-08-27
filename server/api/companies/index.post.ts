import { eq, and } from 'drizzle-orm'
import { company } from '../../database/schema'
import { createCompanySchema } from '../../utils/schemas/orgStructure'

/**
 * POST /api/companies — создание компании (юрлица).
 * isDefault=true снимает флаг с предыдущей компании по умолчанию в той же транзакции
 * (partial unique index company_default_idx допускает только одну).
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { company: ['create'] })
  const orgId = session.session.activeOrganizationId

  const body = await readValidatedBody(event, createCompanySchema.parse)

  const created = await db.transaction(async (tx) => {
    if (body.isDefault) {
      await tx.update(company)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(and(eq(company.organizationId, orgId), eq(company.isDefault, true)))
    }

    const [row] = await tx.insert(company).values({
      organizationId: orgId,
      name: body.name,
      legalName: body.legalName ?? null,
      inn: body.inn ?? null,
      logoUrl: body.logoUrl ?? null,
      isDefault: body.isDefault ?? false,
    }).returning()

    return row
  })

  if (!created) throw createError({ statusCode: 500, statusMessage: 'Не удалось создать компанию' })

  recordActivity({
    organizationId: orgId,
    actorId: session.user.id,
    action: 'created',
    resourceType: 'company',
    resourceId: created.id,
    metadata: { name: created.name },
  })

  setResponseStatus(event, 201)
  return created
})
