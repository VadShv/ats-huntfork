import { getMymeetApiKey } from '../../utils/mymeet/account'
import {
  listMymeetTools, callMymeetTool, resolveToolName, extractToolContent, TOOL_CANDIDATES,
} from '../../utils/mymeet/mcp'

/**
 * GET /api/mymeet/meetings
 * Lists meetings from MyMeet via the resolved MCP tool (for the link dialog).
 * Returns a normalized array plus the raw payload for debugging/mapping.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { candidate: ['read'] })
  const orgId = session.session.activeOrganizationId

  const apiKey = await getMymeetApiKey(orgId)
  if (!apiKey) throw createError({ statusCode: 422, statusMessage: 'MyMeet не подключён' })

  const tools = await listMymeetTools(apiKey)
  const tool = resolveToolName(tools, [...TOOL_CANDIDATES.listMeetings])
  if (!tool) {
    throw createError({
      statusCode: 422,
      statusMessage: 'Не найден MCP-tool для списка встреч. Проверьте discovery в настройках MyMeet.',
    })
  }

  const res = await callMymeetTool(apiKey, tool, {})
  const { json, text } = extractToolContent(res)

  // Normalize best-effort: accept array or { meetings: [...] } / { items: [...] }.
  const arr: any[] = Array.isArray(json)
    ? json
    : Array.isArray((json as any)?.meetings)
      ? (json as any).meetings
      : Array.isArray((json as any)?.items)
        ? (json as any).items
        : []

  const meetings = arr.map((m: any) => ({
    id: String(m?.id ?? m?.meeting_id ?? m?.uuid ?? ''),
    title: m?.title ?? m?.name ?? m?.meeting_title ?? null,
    date: m?.date ?? m?.created_at ?? m?.started_at ?? null,
    durationSec: typeof m?.duration === 'number' ? m.duration : (m?.duration_sec ?? null),
  })).filter(m => m.id)

  return { tool, meetings, raw: json ?? text }
})
