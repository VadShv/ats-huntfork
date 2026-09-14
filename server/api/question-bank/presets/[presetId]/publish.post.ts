import { and, eq } from 'drizzle-orm'
import { questionPreset, presetSection } from '../../../../database/schema'
import { presetIdParamSchema } from '../../../../utils/schemas/preset'

/**
 * POST /api/question-bank/presets/:presetId/publish — публикация пресета.
 * Требует хотя бы один раздел (422). publish.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { questionBank: ['publish'] })
  const orgId = session.session.activeOrganizationId
  const { presetId } = await getValidatedRouterParams(event, presetIdParamSchema.parse)

  const preset = await db.query.questionPreset.findFirst({
    where: and(eq(questionPreset.id, presetId), eq(questionPreset.organizationId, orgId)),
    columns: { id: true, status: true },
  })
  if (!preset) throw createError({ statusCode: 404, statusMessage: 'Пресет не найден' })
  if (preset.status === 'published') return preset

  const section = await db.query.presetSection.findFirst({
    where: and(eq(presetSection.presetId, presetId), eq(presetSection.organizationId, orgId)),
    columns: { id: true },
  })
  if (!section) throw createError({ statusCode: 422, statusMessage: 'Нельзя опубликовать пресет без разделов' })

  const [updated] = await db.update(questionPreset)
    .set({ status: 'published', publishedAt: new Date(), publishedById: session.user.id, updatedAt: new Date() })
    .where(and(eq(questionPreset.id, presetId), eq(questionPreset.organizationId, orgId)))
    .returning()
  return updated
})
