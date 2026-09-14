import { and, eq } from 'drizzle-orm'
import { presetSection, questionPreset } from '../../../../../database/schema'
import { sectionIdParamSchema } from '../../../../../utils/schemas/preset'

/** DELETE /api/question-bank/presets/:presetId/sections/:sectionId — удалить раздел. create_draft. */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { questionBank: ['create_draft'] })
  const orgId = session.session.activeOrganizationId
  const { presetId, sectionId } = await getValidatedRouterParams(event, sectionIdParamSchema.parse)

  const preset = await db.query.questionPreset.findFirst({
    where: and(eq(questionPreset.id, presetId), eq(questionPreset.organizationId, orgId)),
    columns: { status: true },
  })
  if (!preset) throw createError({ statusCode: 404, statusMessage: 'Пресет не найден' })
  if (preset.status === 'published') throw createError({ statusCode: 409, statusMessage: 'Опубликованный пресет нельзя править' })

  await db.delete(presetSection)
    .where(and(eq(presetSection.id, sectionId), eq(presetSection.presetId, presetId), eq(presetSection.organizationId, orgId)))
  setResponseStatus(event, 204)
  return null
})
