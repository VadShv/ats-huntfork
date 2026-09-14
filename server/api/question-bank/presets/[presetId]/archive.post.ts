import { and, eq } from 'drizzle-orm'
import { questionPreset } from '../../../../database/schema'
import { presetIdParamSchema } from '../../../../utils/schemas/preset'

/** POST /api/question-bank/presets/:presetId/archive — soft-архивация пресета. archive. */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { questionBank: ['archive'] })
  const orgId = session.session.activeOrganizationId
  const { presetId } = await getValidatedRouterParams(event, presetIdParamSchema.parse)

  const preset = await db.query.questionPreset.findFirst({
    where: and(eq(questionPreset.id, presetId), eq(questionPreset.organizationId, orgId)),
    columns: { id: true },
  })
  if (!preset) throw createError({ statusCode: 404, statusMessage: 'Пресет не найден' })

  const [updated] = await db.update(questionPreset)
    .set({ status: 'archived', isDefault: false, updatedAt: new Date() })
    .where(and(eq(questionPreset.id, presetId), eq(questionPreset.organizationId, orgId)))
    .returning()
  return updated
})
