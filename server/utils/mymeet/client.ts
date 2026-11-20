/**
 * Фасад MyMeet: один вход для воркеров и API, два транспорта под капотом.
 *
 *   REST  backend.mymeet.ai  (Yandex.Cloud, Москва) — основной: стабилен из РФ,
 *                            отдаёт транскрипт и отчёты одним запросом.
 *   MCP   mcp.mymeet.ai      (Google Cloud, NL)     — запасной: тот же ключ,
 *                            инструменты mymeet_get_transcript / _report / …
 *
 * Порядок задаётся MYMEET_TRANSPORT_ORDER (по умолчанию «rest,mcp»). Если первый
 * транспорт падает по сети/HTTP — пробуем второй; в ошибке возвращаем обе причины,
 * чтобы по тексту в UI было ясно, что именно недоступно.
 *
 * Семантика «не готово» (MyMeet ещё обрабатывает запись) отделена от ошибок:
 * вызывающий код решает — подождать и повторить (pg-boss retry) или сообщить.
 */
import {
  callMymeetByKey, listMymeetTools, type McpTool,
} from './mcp'
import {
  MymeetRestError, restGetMeetingReport, restGetMeetingStatus, restListMeetings, restPing,
  extractDurationSecFromReport, extractParticipantsFromReport, extractSummaryFromReport,
  extractTitleFromReport, extractTranscriptFromReport,
} from './rest'

export type MymeetTransport = 'rest' | 'mcp'

export function transportOrder(): MymeetTransport[] {
  const raw = (process.env.MYMEET_TRANSPORT_ORDER || 'rest,mcp').split(',').map(s => s.trim().toLowerCase())
  const order = raw.filter((s): s is MymeetTransport => s === 'rest' || s === 'mcp')
  return order.length ? Array.from(new Set(order)) : ['rest', 'mcp']
}

/** Ошибка, у которой есть причины по каждому транспорту. */
export class MymeetUnavailableError extends Error {
  constructor(public readonly reasons: Partial<Record<MymeetTransport, string>>, what: string) {
    const list = Object.entries(reasons).map(([t, r]) => `${t.toUpperCase()}: ${r}`).join('; ')
    super(`${what} — ${list || 'MyMeet недоступен'}`)
    this.name = 'MymeetUnavailableError'
  }
}

export class MymeetNotReadyError extends Error {
  constructor(public readonly meetingId: string, public readonly status?: string) {
    super(`MyMeet ещё обрабатывает встречу ${meetingId}${status ? ` (статус: ${status})` : ''}`)
    this.name = 'MymeetNotReadyError'
  }
}

export interface MeetingData {
  via: MymeetTransport
  json: Record<string, unknown> | null
  transcriptText: string | null
  summary: string | null
  title: string | null
  durationSec: number | null
  participants: unknown[] | null
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

// ─── Транскрипт ────────────────────────────────────────────────────────────────

/**
 * Транскрипт встречи. REST: из полного JSON отчёта; MCP: tool get_transcript.
 * Бросает MymeetNotReadyError, если запись ещё обрабатывается, и
 * MymeetUnavailableError, если не удалось ни по одному транспорту.
 */
export async function fetchMeetingTranscript(
  apiKey: string,
  meetingId: string,
  opts: { toolsCache?: McpTool[] } = {},
): Promise<{ text: string, via: MymeetTransport }> {
  const reasons: Partial<Record<MymeetTransport, string>> = {}
  for (const t of transportOrder()) {
    try {
      if (t === 'rest') {
        const r = await restGetMeetingReport(apiKey, meetingId)
        if (!r.ready) throw new MymeetNotReadyError(meetingId)
        const text = extractTranscriptFromReport(r.json)
        if (text) return { text, via: 'rest' }
        reasons.rest = `в ответе ${Object.keys(r.json ?? {}).slice(0, 12).join(', ') || '(пусто)'} не найден транскрипт`
        continue
      }
      const res = await callMymeetByKey(apiKey, 'getTranscript', { meetingId, meeting_id: meetingId }, opts.toolsCache)
      if (!res) { reasons.mcp = 'tool get_transcript не найден (discovery)'; continue }
      const text = res.text?.trim() || (res.json ? JSON.stringify(res.json) : '')
      if (text) return { text, via: 'mcp' }
      reasons.mcp = 'tool вернул пустой транскрипт'
    }
    catch (e) {
      if (e instanceof MymeetNotReadyError) throw e
      // 404 по REST — ID неверный; дальше пробовать MCP смысла мало, но пробуем:
      // у MCP другая проверка прав (scope mine/workspace).
      reasons[t] = errMsg(e)
    }
  }
  throw new MymeetUnavailableError(reasons, 'Не удалось получить транскрипт')
}

// ─── Полные данные встречи (поток А) ───────────────────────────────────────────

/**
 * Отчёт + транскрипт + метаданные. REST — одним запросом; MCP — двумя tools.
 */
export async function fetchMeetingData(
  apiKey: string,
  meetingId: string,
  opts: { toolsCache?: McpTool[] } = {},
): Promise<MeetingData> {
  const reasons: Partial<Record<MymeetTransport, string>> = {}
  for (const t of transportOrder()) {
    try {
      if (t === 'rest') {
        const r = await restGetMeetingReport(apiKey, meetingId)
        if (!r.ready) throw new MymeetNotReadyError(meetingId)
        return {
          via: 'rest',
          json: r.json,
          transcriptText: extractTranscriptFromReport(r.json),
          summary: extractSummaryFromReport(r.json) ?? null,
          title: extractTitleFromReport(r.json) ?? null,
          durationSec: extractDurationSecFromReport(r.json) ?? null,
          participants: extractParticipantsFromReport(r.json) ?? null,
        }
      }
      const tools = opts.toolsCache ?? await listMymeetTools(apiKey)
      const report = await callMymeetByKey(apiKey, 'getReport', { meetingId, meeting_id: meetingId }, tools)
      const transcript = await callMymeetByKey(apiKey, 'getTranscript', { meetingId, meeting_id: meetingId }, tools).catch(() => null)
      if (!report && !transcript) { reasons.mcp = 'не найдены tools отчёта/транскрипта (discovery)'; continue }
      const json = (report?.json && typeof report.json === 'object') ? report.json as Record<string, unknown> : (report?.text ? { text: report.text } : null)
      const summary = extractSummaryFromReport(json) ?? (report?.text ? report.text.slice(0, 2000) : null)
      const transcriptText = transcript?.text?.trim() || extractTranscriptFromReport(transcript?.json) || null
      return {
        via: 'mcp',
        json,
        transcriptText,
        summary,
        title: extractTitleFromReport(json) ?? null,
        durationSec: extractDurationSecFromReport(json) ?? null,
        participants: extractParticipantsFromReport(json) ?? null,
      }
    }
    catch (e) {
      if (e instanceof MymeetNotReadyError) throw e
      reasons[t] = errMsg(e)
    }
  }
  throw new MymeetUnavailableError(reasons, 'Не удалось получить данные встречи')
}

// ─── Список встреч (диалог привязки) ───────────────────────────────────────────

export interface MeetingListItem { id: string, title: string | null, date: string | null, durationSec: number | null, status?: string | null }

export async function fetchMeetingList(apiKey: string, opts: { perPage?: number } = {}): Promise<{ via: MymeetTransport, meetings: MeetingListItem[], raw: unknown }> {
  const reasons: Partial<Record<MymeetTransport, string>> = {}
  for (const t of transportOrder()) {
    try {
      if (t === 'rest') {
        const r = await restListMeetings(apiKey, { page: 0, perPage: opts.perPage ?? 50 })
        return { via: 'rest', meetings: r.meetings, raw: r.raw }
      }
      const res = await callMymeetByKey(apiKey, 'listMeetings', { scope: 'workspace', page: 1, perPage: Math.min(opts.perPage ?? 50, 50) })
      if (!res) { reasons.mcp = 'tool list_meetings не найден (discovery)'; continue }
      const j = res.json as any
      const arr: any[] = Array.isArray(j) ? j : Array.isArray(j?.meetings) ? j.meetings : Array.isArray(j?.items) ? j.items : []
      const meetings = arr.map((m): MeetingListItem => ({
        id: String(m?.meeting_id ?? m?.id ?? m?.uuid ?? ''),
        title: m?.title ?? m?.name ?? null,
        date: m?.created_at ?? m?.date ?? m?.started_at ?? null,
        durationSec: typeof m?.duration === 'number' ? m.duration : null,
        status: typeof m?.status === 'string' ? m.status : null,
      })).filter(m => m.id)
      return { via: 'mcp', meetings, raw: res.json ?? res.text }
    }
    catch (e) {
      reasons[t] = errMsg(e)
    }
  }
  throw new MymeetUnavailableError(reasons, 'Не удалось получить список встреч')
}

// ─── Проверка соединения (настройки) ───────────────────────────────────────────

export interface ConnectivityReport {
  ok: boolean
  rest: { ok: boolean, error?: string, endpoint?: string }
  mcp: { ok: boolean, error?: string, tools: McpTool[] }
}

/** Проверяет оба транспорта с данным ключом. ok — хотя бы один работает. */
export async function checkMymeetConnectivity(apiKey: string): Promise<ConnectivityReport> {
  const [rest, mcp] = await Promise.all([
    restPing(apiKey),
    listMymeetTools(apiKey).then(tools => ({ ok: true as const, tools })).catch((e: unknown) => ({ ok: false as const, error: errMsg(e), tools: [] as McpTool[] })),
  ])
  return {
    ok: rest.ok || mcp.ok,
    rest: rest.ok ? { ok: true, endpoint: rest.endpoint } : { ok: false, error: rest.error },
    mcp,
  }
}

/** Статус встречи (REST; при недоступности — MCP). */
export async function fetchMeetingStatus(apiKey: string, meetingId: string): Promise<string | null> {
  for (const t of transportOrder()) {
    try {
      if (t === 'rest') return await restGetMeetingStatus(apiKey, meetingId)
      const res = await callMymeetByKey(apiKey, 'getStatus', { meetingId, meeting_id: meetingId })
      if (res) return (res.json as any)?.status ?? res.text ?? null
    }
    catch (e) {
      if (e instanceof MymeetRestError && e.kind === 'not_found') throw e
    }
  }
  return null
}
