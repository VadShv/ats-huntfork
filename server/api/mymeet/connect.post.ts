import { eq } from 'drizzle-orm'
import { mymeetAccount } from '../../database/schema'
import { connectMymeetSchema } from '../../utils/schemas/mymeet'
import { upsertMymeetAccount } from '../../utils/mymeet/account'
import { checkMymeetConnectivity } from '../../utils/mymeet/client'

/**
 * POST /api/mymeet/connect
 * Сохраняет API-ключ организации (шифрованно), предварительно проверив его по REST
 * и/или MCP. Достаточно одного рабочего транспорта. Ключ клиенту не возвращается.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { organization: ['update'] })
  const orgId = session.session.activeOrganizationId
  const body = await readValidatedBody(event, connectMymeetSchema.parse)

  const report = await checkMymeetConnectivity(body.apiKey)
  if (!report.ok) {
    throw createError({
      statusCode: 422,
      statusMessage: `Не удалось подключиться к MyMeet. REST: ${report.rest.error ?? '—'}; MCP: ${report.mcp.error ?? '—'}`,
    })
  }

  await upsertMymeetAccount(orgId, body.apiKey, session.user.id)
  await db.update(mymeetAccount)
    .set({
      lastToolsJson: {
        tools: report.mcp.tools,
        transports: { rest: report.rest, mcp: { ok: report.mcp.ok, error: report.mcp.error ?? null } },
      } as unknown as Record<string, unknown>,
      lastCheckedAt: new Date(),
    })
    .where(eq(mymeetAccount.organizationId, orgId))

  return {
    connected: true,
    toolCount: report.mcp.tools.length,
    tools: report.mcp.tools.map(t => ({ name: t.name, description: t.description })),
    transports: { rest: report.rest, mcp: { ok: report.mcp.ok, error: report.mcp.error ?? null } },
  }
})
