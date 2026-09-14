import { and, eq } from 'drizzle-orm'
import { careMethodology } from '../../../../../../database/schema'
import { versionParamSchema } from '../../../../../../utils/schemas/care'

/**
 * POST /api/question-bank/care/methodology/versions/:version/activate
 * Откат/переключение активной версии методики. manage_care.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { questionBank: ['manage_care'] })
  const orgId = session.session.activeOrganizationId
  const { version } = await getValidatedRouterParams(event, versionParamSchema.parse)

  const target = await db.query.careMethodology.findFirst({
    where: and(eq(careMethodology.organizationId, orgId), eq(careMethodology.version, version)),
    columns: { id: true },
  })
  if (!target) throw createError({ statusCode: 404, statusMessage: 'Версия методики не найдена' })

  return db.transaction(async (tx) => {
    await tx.update(careMethodology)
      .set({ isActive: false })
      .where(and(eq(careMethodology.organizationId, orgId), eq(careMethodology.isActive, true)))
    const [activated] = await tx.update(careMethodology)
      .set({ isActive: true, updatedAt: new Date() })
      .where(and(eq(careMethodology.organizationId, orgId), eq(careMethodology.version, version)))
      .returning()
    return activated
  })
})
