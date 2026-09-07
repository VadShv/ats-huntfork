import { connectMymeetSchema } from '../../utils/schemas/mymeet'
import { upsertMymeetAccount } from '../../utils/mymeet/account'
import { listMymeetTools } from '../../utils/mymeet/mcp'

/**
 * POST /api/mymeet/connect
 * Store the org's MyMeet API key (encrypted) after verifying it via tools/list.
 * The key is never returned to the client.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { organization: ['update'] })
  const orgId = session.session.activeOrganizationId
  const body = await readValidatedBody(event, connectMymeetSchema.parse)

  // Verify the key works (MCP tools/list) before persisting.
  let tools
  try {
    tools = await listMymeetTools(body.apiKey)
  }
  catch (err) {
    throw createError({
      statusCode: 422,
      statusMessage: `Не удалось подключиться к MyMeet: ${err instanceof Error ? err.message : 'ошибка соединения'}`,
    })
  }

  await upsertMymeetAccount(orgId, body.apiKey, session.user.id)

  return { connected: true, toolCount: tools.length, tools: tools.map(t => ({ name: t.name, description: t.description })) }
})
