import { and, eq } from 'drizzle-orm'
import { carePrompt } from '../../../../database/schema'
import { ensureCareMethodology } from '../../../../utils/questions/seedCareMethodology'

/** GET /api/question-bank/care/prompts — активные промпты всех kind. view. */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { questionBank: ['view'] })
  const orgId = session.session.activeOrganizationId
  await ensureCareMethodology(orgId, session.user.id) // seed промптов при первом заходе

  const items = await db.query.carePrompt.findMany({
    where: and(eq(carePrompt.organizationId, orgId), eq(carePrompt.isActive, true)),
  })
  return { items }
})
