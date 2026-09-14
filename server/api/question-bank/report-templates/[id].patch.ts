import { and, eq } from 'drizzle-orm'
import { reportTemplate } from '../../../database/schema'
import { reportTemplateIdParamSchema, updateReportTemplateSchema } from '../../../utils/schemas/reportTemplate'

/**
 * PATCH /api/question-bank/report-templates/:id — правка шаблона.
 * Смена promptText инкрементит version (аудит). manage_reports.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { questionBank: ['manage_reports'] })
  const orgId = session.session.activeOrganizationId
  const { id } = await getValidatedRouterParams(event, reportTemplateIdParamSchema.parse)
  const body = await readValidatedBody(event, updateReportTemplateSchema.parse)

  const existing = await db.query.reportTemplate.findFirst({
    where: and(eq(reportTemplate.id, id), eq(reportTemplate.organizationId, orgId)),
    columns: { id: true, version: true, promptText: true },
  })
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Шаблон не найден' })

  const patch: Record<string, unknown> = { updatedAt: new Date(), updatedById: session.user.id }
  for (const k of ['name', 'description', 'kind', 'promptText', 'preferredAiConfigId'] as const) {
    if (body[k] !== undefined) patch[k] = body[k]
  }
  if (body.promptText !== undefined && body.promptText !== existing.promptText) {
    patch.version = existing.version + 1
  }

  const [updated] = await db.update(reportTemplate)
    .set(patch)
    .where(and(eq(reportTemplate.id, id), eq(reportTemplate.organizationId, orgId)))
    .returning()
  return updated
})
