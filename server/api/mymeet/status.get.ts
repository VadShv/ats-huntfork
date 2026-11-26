import { eq } from 'drizzle-orm'
import { mymeetAccount } from '../../database/schema'

/**
 * GET /api/mymeet/status
 * Whether MyMeet is connected + cached discovery (tools). Never returns the key.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { organization: ['read'] })
  const orgId = session.session.activeOrganizationId

  const row = await db.query.mymeetAccount.findFirst({
    where: eq(mymeetAccount.organizationId, orgId),
    columns: { id: true, lastToolsJson: true, lastCheckedAt: true },
  })

  const cached = row?.lastToolsJson as {
    tools?: Array<{ name: string, description?: string }>
    transports?: { rest?: { ok: boolean, error?: string | null }, mcp?: { ok: boolean, error?: string | null } }
  } | null
  return {
    connected: Boolean(row),
    hasApiKey: Boolean(row),
    lastCheckedAt: row?.lastCheckedAt ?? null,
    tools: cached?.tools ?? [],
    transports: cached?.transports ?? null,
  }
})
