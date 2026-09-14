import { and, eq } from 'drizzle-orm'
import { reportTemplate } from '../../../../database/schema'
import { reportTemplateIdParamSchema } from '../../../../utils/schemas/reportTemplate'

/**
 * POST /api/question-bank/report-templates/:id/set-default — сделать шаблоном по
 * умолчанию (атомарно снять со старого). Только активный. manage_reports.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { questionBank: ['manage_reports'] })
  const orgId = session.session.activeOrganizationId
  const { id } = await getValidatedRouterParams(event, reportTemplateIdParamSchema.parse)

  const tpl = await db.query.reportTemplate.findFirst({
    where: and(eq(reportTemplate.id, id), eq(reportTemplate.organizationId, orgId)),
    columns: { id: true, isActive: true },
  })
  if (!tpl) throw createError({ statusCode: 404, statusMessage: 'Шаблон не найден' })
  if (!tpl.isActive) throw createError({ statusCode: 422, statusMessage: 'Нельзя сделать выключенный шаблон дефолтным' })

  return db.transaction(async (tx) => {
    await tx.update(reportTemplate)
      .set({ isDefault: false })
      .where(and(eq(reportTemplate.organizationId, orgId), eq(reportTemplate.isDefault, true)))
    const [updated] = await tx.update(reportTemplate)
      .set({ isDefault: true, updatedAt: new Date() })
      .where(and(eq(reportTemplate.id, id), eq(reportTemplate.organizationId, orgId)))
      .returning()
    return updated
  })
})
