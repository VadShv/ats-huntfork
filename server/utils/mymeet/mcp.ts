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
export const TOOL_CANDIDATES = {
  listMeetings: ['list_meetings', 'meetings', 'list_recordings', 'recordings'],
  getReport: ['get_report', 'report', 'get_meeting', 'meeting'],
  getTranscript: ['get_transcript', 'transcript'],
} as const

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
