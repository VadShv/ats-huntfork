import { and, eq, asc } from 'drizzle-orm'
import { questionPreset } from '../../../database/schema'
import { presetIdParamSchema } from '../../../utils/schemas/preset'

/** GET /api/question-bank/presets/:presetId — пресет + разделы + вопросы. view. */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { questionBank: ['view'] })
  const orgId = session.session.activeOrganizationId
  const { presetId } = await getValidatedRouterParams(event, presetIdParamSchema.parse)

  const preset = await db.query.questionPreset.findFirst({
    where: and(eq(questionPreset.id, presetId), eq(questionPreset.organizationId, orgId)),
    with: {
      sections: {
        orderBy: (s) => [asc(s.displayOrder)],
        with: { topic: { columns: { id: true, name: true, type: true } }, questions: true },
      },
    },
  })
  if (!preset) throw createError({ statusCode: 404, statusMessage: 'Пресет не найден' })
  return preset
})
