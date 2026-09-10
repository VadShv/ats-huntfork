import { eq, and } from 'drizzle-orm'
import { messageTemplate } from '../../../database/schema'

export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { application: ['update'] })
  const orgId = session.session.activeOrganizationId
  const id = getRouterParam(event, 'id')!

  await db.delete(messageTemplate)
    .where(and(eq(messageTemplate.id, id), eq(messageTemplate.organizationId, orgId)))

  return { ok: true }
})
