import { and, eq } from 'drizzle-orm'
import { reportTemplate } from '../../../../database/schema'
import { reportTemplateIdParamSchema, toggleActiveSchema } from '../../../../utils/schemas/reportTemplate'

/**
 * POST /api/question-bank/report-templates/:id/toggle-active — soft вкл/выкл.
 * Нельзя выключить текущий default (422). manage_reports.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { questionBank: ['manage_reports'] })
  const orgId = session.session.activeOrganizationId
  const { id } = await getValidatedRouterParams(event, reportTemplateIdParamSchema.parse)
  const body = await readValidatedBody(event, toggleActiveSchema.parse)

  const tpl = await db.query.reportTemplate.findFirst({
    where: and(eq(reportTemplate.id, id), eq(reportTemplate.organizationId, orgId)),
    columns: { id: true, isDefault: true },
  })
  if (!tpl) throw createError({ statusCode: 404, statusMessage: 'Шаблон не найден' })
  if (!body.isActive && tpl.isDefault) {
    throw createError({ statusCode: 422, statusMessage: 'Нельзя выключить шаблон по умолчанию. Сначала назначьте другой.' })
  }

  const [updated] = await db.update(reportTemplate)
    .set({ isActive: body.isActive, updatedAt: new Date() })
    .where(and(eq(reportTemplate.id, id), eq(reportTemplate.organizationId, orgId)))
    .returning()
  return updated
})
