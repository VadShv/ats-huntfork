import { eq, and, asc } from 'drizzle-orm'
import { sourcingChannel } from '../../../database/schema/app'

/**
 * GET /api/search-map/channels — список каналов орг (с сидом системных).
 * Право: searchMap:view
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { searchMap: ['view'] })
  const orgId = session.session.activeOrganizationId

  await ensureSystemChannels(orgId)

  const channels = await db.select().from(sourcingChannel)
    .where(eq(sourcingChannel.organizationId, orgId))
    .orderBy(asc(sourcingChannel.displayOrder))

  return { items: channels }
})
