import { and, eq } from 'drizzle-orm'
import { carePrompt } from '../../../../database/schema'
import { carePromptKindParamSchema } from '../../../../utils/schemas/care'
import { ensureCareMethodology } from '../../../../utils/questions/seedCareMethodology'

/** GET /api/question-bank/care/prompts/:kind — активный промпт одного kind. view. */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { questionBank: ['view'] })
  const orgId = session.session.activeOrganizationId
  const { kind } = await getValidatedRouterParams(event, carePromptKindParamSchema.parse)
  await ensureCareMethodology(orgId, session.user.id)

  const prompt = await db.query.carePrompt.findFirst({
    where: and(eq(carePrompt.organizationId, orgId), eq(carePrompt.kind, kind), eq(carePrompt.isActive, true)),
  })
  if (!prompt) throw createError({ statusCode: 404, statusMessage: 'Промпт не найден' })
  return prompt
})
