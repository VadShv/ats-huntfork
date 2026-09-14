import { and, eq } from 'drizzle-orm'
import { reportTemplate } from '../../../database/schema'
import { reportTemplateIdParamSchema } from '../../../utils/schemas/reportTemplate'

/** GET /api/question-bank/report-templates/:id. view. */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { questionBank: ['view'] })
  const orgId = session.session.activeOrganizationId
  const { id } = await getValidatedRouterParams(event, reportTemplateIdParamSchema.parse)

  const tpl = await db.query.reportTemplate.findFirst({
    where: and(eq(reportTemplate.id, id), eq(reportTemplate.organizationId, orgId)),
  })
  if (!tpl) throw createError({ statusCode: 404, statusMessage: 'Шаблон не найден' })
  return tpl
})
