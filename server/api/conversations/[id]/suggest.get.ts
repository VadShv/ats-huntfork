import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { commsConversation } from '../../../database/schema'
import { getLatestDraft } from '../../../utils/comms/assistantJobs'

const paramsSchema = z.object({ id: z.string().min(1) })

/**
 * GET /api/conversations/:id/suggest — текущий черновик ассистента.
 * Чат 2.0: фронт опрашивает этот эндпоинт, пока черновик в статусе generating.
 */
export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const orgId = session.session.activeOrganizationId
  const { id } = await getValidatedRouterParams(event, paramsSchema.parse)

  const conv = await db.query.commsConversation.findFirst({
    where: and(eq(commsConversation.id, id), eq(commsConversation.organizationId, orgId)),
    columns: { id: true },
  })
  if (!conv) {
    throw createError({ statusCode: 404, statusMessage: 'Диалог не найден' })
  }

  return { draft: await getLatestDraft(conv.id) }
})
