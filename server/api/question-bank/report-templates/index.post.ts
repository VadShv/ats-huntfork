import { reportTemplate } from '../../../database/schema'
import { createReportTemplateSchema } from '../../../utils/schemas/reportTemplate'

/** POST /api/question-bank/report-templates — создать шаблон. manage_reports. */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { questionBank: ['manage_reports'] })
  const orgId = session.session.activeOrganizationId
  const body = await readValidatedBody(event, createReportTemplateSchema.parse)

  const [created] = await db.insert(reportTemplate).values({
    organizationId: orgId,
    name: body.name,
    description: body.description ?? null,
    kind: body.kind,
    promptText: body.promptText,
    preferredAiConfigId: body.preferredAiConfigId ?? null,
    isDefault: false,
    isActive: true,
    createdById: session.user.id,
    updatedById: session.user.id,
  }).returning()

  setResponseStatus(event, 201)
  return created
})
