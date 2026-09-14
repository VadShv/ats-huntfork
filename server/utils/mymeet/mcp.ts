/**
 * MyMeet MCP-клиент (Этап 5).
 *
 * MyMeet предоставляет MCP-сервер (не REST):
 *   endpoint  https://mcp.mymeet.ai/mcp   (streamable HTTP)
 *   auth      Authorization: Bearer <api-key>
 *
 * Бэкенд подключается к нему напрямую через официальный @modelcontextprotocol/sdk,
 * получает список tools (tools/list) и вызывает их (tools/call) детерминированно —
 * без внешнего AI-агента.
 *
 * ВАЖНО (discovery): реальные имена tools MyMeet узнаются только прогоном tools/list
 * с настоящим ключом. Поэтому высокоуровневые функции (listMeetings/getReport/
 * getTranscript) резолвят имя tool из обнаруженного списка по кандидатам-паттернам
 * (resolveToolName). После первого discovery имена кэшируются в
 * mymeet_account.last_tools_json; при необходимости точные имена можно захардкодить
 * здесь, увидев их в /api/mymeet/status.
 *
 * Соединение открывается на один вызов и закрывается (без пула в MVP).
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const MYMEET_MCP_URL = process.env.MYMEET_MCP_URL || 'https://mcp.mymeet.ai/mcp'

export interface McpTool {
  name: string
  description?: string
  inputSchema?: unknown
}

async function withClient<T>(apiKey: string, fn: (client: Client) => Promise<T>): Promise<T> {
  const transport = new StreamableHTTPClientTransport(new URL(MYMEET_MCP_URL), {
    requestInit: { headers: { Authorization: `Bearer ${apiKey}` } },
  })
  const client = new Client({ name: 'reqcore-mymeet', version: '1.0.0' })
  try {
    await client.connect(transport)
    return await fn(client)
  }
  finally {
    await client.close().catch(() => {})
  }
}

/** tools/list — используется для discovery и «Проверить соединение». */
export async function listMymeetTools(apiKey: string): Promise<McpTool[]> {
  return withClient(apiKey, async (client) => {
    const res = await client.listTools()
    return (res.tools ?? []).map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }))
  })
}

/** tools/call — низкоуровневый вызов конкретного tool. */
export async function callMymeetTool(apiKey: string, name: string, args: Record<string, unknown>): Promise<unknown> {
  return withClient(apiKey, async (client) => {
    const res = await client.callTool({ name, arguments: args })
    return res
  })
}

/**
 * Резолвит имя tool из обнаруженного списка по кандидатам-подстрокам.
 * Возвращает первое совпадение или null (тогда UI покажет discovery-подсказку).
 */
export function resolveToolName(tools: McpTool[], candidates: string[]): string | null {
  const names = tools.map(t => t.name)
  for (const c of candidates) {
    const hit = names.find(n => n.toLowerCase().includes(c.toLowerCase()))
    if (hit) return hit
  }
  return null
}

// Кандидаты имён tools (уточняются после discovery — см. mymeet_account.last_tools_json).
// Спринт 5: добавлены status/search/download/record/regenerate_template для
// связки hr-interview и генерации нашего отчёта из транскрипта.
export const TOOL_CANDIDATES = {
  listMeetings: ['mymeet_list_meetings', 'list_meetings', 'meetings', 'list_recordings', 'recordings'],
  getReport: ['mymeet_get_meeting_report', 'get_report', 'report', 'get_meeting', 'meeting'],
  getTranscript: ['mymeet_get_transcript', 'get_transcript', 'transcript'],
  getStatus: ['mymeet_get_meeting_status', 'get_meeting_status', 'status'],
  searchMeetings: ['mymeet_search_meetings', 'search_meetings', 'search'],
  downloadMeeting: ['mymeet_download_meeting', 'download_meeting', 'download'],
  recordMeeting: ['mymeet_record_meeting', 'record_meeting', 'record'],
  regenerateTemplate: ['mymeet_regenerate_template', 'regenerate_template', 'regenerate'],
} as const

/**
 * Высокоуровневый вызов tool по ключу-кандидату: делает discovery (или берёт
 * переданный список), резолвит имя, вызывает, возвращает извлечённый контент.
 * Спринт 5: используется генерацией отчёта (транскрипт) и связкой hr-interview.
 */
export async function callMymeetByKey(
  apiKey: string,
  key: keyof typeof TOOL_CANDIDATES,
  args: Record<string, unknown>,
  toolsCache?: McpTool[],
): Promise<{ text: string, json: unknown, toolName: string } | null> {
  const tools = toolsCache ?? await listMymeetTools(apiKey)
  const name = resolveToolName(tools, [...TOOL_CANDIDATES[key]])
  if (!name) return null
  const raw = await callMymeetTool(apiKey, name, args)
  const { text, json } = extractToolContent(raw)
  return { text, json, toolName: name }
}

/** Извлекает «сырой» текстовый/структурный контент из MCP CallToolResult. */
export function extractToolContent(result: unknown): { text: string, json: unknown } {
  const r = result as { content?: Array<{ type?: string, text?: string, resource?: unknown }>, structuredContent?: unknown } | null
  let text = ''
  let json: unknown = r?.structuredContent ?? null
  if (Array.isArray(r?.content)) {
    for (const c of r!.content) {
      if (c?.type === 'text' && typeof c.text === 'string') text += (text ? '\n' : '') + c.text
    }
  }
  // Некоторые серверы кладут JSON в text — пробуем распарсить.
  if (json == null && text) {
    try { json = JSON.parse(text) }
    catch { /* оставляем text как есть */ }
  }
  return { text, json }
}
