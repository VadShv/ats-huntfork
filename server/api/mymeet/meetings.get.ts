import { getMymeetApiKey } from '../../utils/mymeet/account'
import { fetchMeetingList, MymeetUnavailableError } from '../../utils/mymeet/client'

/**
 * GET /api/mymeet/meetings
 * Список встреч MyMeet для диалога привязки. REST (backend.mymeet.ai) → запасной MCP.
 * Возвращает нормализованный массив + сырой ответ (для отладки маппинга).
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { candidate: ['read'] })
  const orgId = session.session.activeOrganizationId

  const apiKey = await getMymeetApiKey(orgId)
  if (!apiKey) throw createError({ statusCode: 422, statusMessage: 'MyMeet не подключён' })

  try {
    const { via, meetings, raw } = await fetchMeetingList(apiKey, { perPage: 50 })
    return { tool: via, via, meetings, raw }
  }
  catch (err) {
    const message = err instanceof MymeetUnavailableError ? err.message : `MyMeet недоступен: ${err instanceof Error ? err.message : 'ошибка'}`
    throw createError({ statusCode: 502, statusMessage: message })
  }
})
