import { eq } from 'drizzle-orm'
import { mymeetAccount } from '../../database/schema'
import { getMymeetApiKey } from '../../utils/mymeet/account'
import { checkMymeetConnectivity } from '../../utils/mymeet/client'

/**
 * POST /api/mymeet/test
 * Проверяет сохранённый ключ по обоим транспортам (REST backend.mymeet.ai и MCP
 * mcp.mymeet.ai), обновляет кэш discovery. Успех — если работает хотя бы один;
 * в ответе — состояние каждого, чтобы в настройках было видно, какой канал лежит.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { organization: ['read'] })
  const orgId = session.session.activeOrganizationId

  const apiKey = await getMymeetApiKey(orgId)
  if (!apiKey) throw createError({ statusCode: 422, statusMessage: 'MyMeet не подключён' })

  const report = await checkMymeetConnectivity(apiKey)

  await db.update(mymeetAccount)
    .set({
      lastToolsJson: {
        tools: report.mcp.tools,
        transports: { rest: report.rest, mcp: { ok: report.mcp.ok, error: report.mcp.error ?? null } },
      } as unknown as Record<string, unknown>,
      lastCheckedAt: new Date(),
    })
    .where(eq(mymeetAccount.organizationId, orgId))

  if (!report.ok) {
    throw createError({
      statusCode: 502,
      statusMessage: `MyMeet недоступен. REST: ${report.rest.error ?? '—'}; MCP: ${report.mcp.error ?? '—'}`,
    })
  }

  return {
    ok: true,
    toolCount: report.mcp.tools.length,
    tools: report.mcp.tools.map(t => ({ name: t.name, description: t.description })),
    transports: { rest: report.rest, mcp: { ok: report.mcp.ok, error: report.mcp.error ?? null } },
  }
})
