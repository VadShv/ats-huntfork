import { eq } from 'drizzle-orm'
import { mymeetAccount } from '../../database/schema'
import { getMymeetApiKey } from '../../utils/mymeet/account'
import { listMymeetTools } from '../../utils/mymeet/mcp'

/**
 * POST /api/mymeet/test
 * Re-run tools/list on the stored key, refresh the cached discovery.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { organization: ['read'] })
  const orgId = session.session.activeOrganizationId

  const apiKey = await getMymeetApiKey(orgId)
  if (!apiKey) throw createError({ statusCode: 422, statusMessage: 'MyMeet не подключён' })

  let tools
  try {
    tools = await listMymeetTools(apiKey)
  }
  catch (err) {
    throw createError({ statusCode: 502, statusMessage: `MyMeet недоступен: ${err instanceof Error ? err.message : 'ошибка'}` })
  }

  await db.update(mymeetAccount)
    .set({ lastToolsJson: { tools } as unknown as Record<string, unknown>, lastCheckedAt: new Date() })
    .where(eq(mymeetAccount.organizationId, orgId))

  return { ok: true, toolCount: tools.length, tools: tools.map(t => ({ name: t.name, description: t.description })) }
})
