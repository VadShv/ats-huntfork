/**
 * MyMeet REST-клиент (backend.mymeet.ai).
 *
 * Зачем второй транспорт рядом с MCP (mcp.ts):
 *   • mcp.mymeet.ai хостится в Google Cloud (NL) — с российских площадок соединение
 *     нестабильно («fetch failed» на уровне TCP/TLS);
 *   • backend.mymeet.ai — Yandex.Cloud (Москва), тот же API-ключ, заголовок X-API-KEY;
 *   • REST отдаёт полный JSON встречи одним запросом (транскрипт + отчёты по шаблонам),
 *     и это официально документировано: https://github.com/MyMeetAI/API-Docs
 *
 * Формат JSON отчёта у MyMeet не зафиксирован схемой, поэтому извлечение транскрипта
 * и summary — толерантное (см. extractTranscriptFromReport / extractSummaryFromReport):
 * ищем по известным ключам, а не по жёсткой структуре. Сырой JSON всегда сохраняется
 * в meeting_report.report_json, чтобы маппинг можно было уточнить без повторного импорта.
 */

const MYMEET_REST_URL = (process.env.MYMEET_REST_URL || 'https://backend.mymeet.ai').replace(/\/+$/, '')
const REQUEST_TIMEOUT_MS = Number(process.env.MYMEET_REST_TIMEOUT_MS || 25_000)

export class MymeetRestError extends Error {
  constructor(
    message: string,
    public readonly status: number | null,
    public readonly kind: 'network' | 'auth' | 'not_found' | 'not_ready' | 'quota' | 'http',
  ) {
    super(message)
    this.name = 'MymeetRestError'
  }
}

/**
 * Человекочитаемое описание ошибки fetch. Node/undici прячет причину в `cause`
 * («fetch failed» без кода) — вытаскиваем код (ECONNRESET, ENOTFOUND, ETIMEDOUT,
 * CERT_…) и хост, чтобы в UI было видно, ЧТО именно не так.
 */
export function describeFetchError(err: unknown, host: string): string {
  if (!(err instanceof Error)) return `${String(err)} (${host})`
  const cause = (err as Error & { cause?: unknown }).cause as { code?: string, message?: string, name?: string } | undefined
  const parts: string[] = []
  if (err.name === 'TimeoutError' || err.name === 'AbortError') parts.push('таймаут')
  else parts.push(err.message)
  if (cause) {
    const code = cause.code || cause.name
    if (code && !parts.join(' ').includes(code)) parts.push(code)
    if (cause.message && cause.message !== err.message && !cause.message.includes('fetch failed')) parts.push(cause.message)
  }
  return `${parts.join(' · ')} (${host})`
}

export function mymeetRestHost(): string {
  try { return new URL(MYMEET_REST_URL).host }
  catch { return MYMEET_REST_URL }
}

async function restRequest(
  apiKey: string,
  path: string,
  params: Record<string, string | number | undefined> = {},
  init: { method?: 'GET' | 'POST' | 'DELETE' | 'PUT', body?: unknown } = {},
): Promise<Response> {
  const url = new URL(MYMEET_REST_URL + path)
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v))
  }
  const headers: Record<string, string> = { 'X-API-KEY': apiKey, 'Accept': 'application/json' }
  let body: string | undefined
  if (init.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(init.body)
  }
  try {
    return await fetch(url, {
      method: init.method ?? 'GET',
      headers,
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  }
  catch (err) {
    throw new MymeetRestError(describeFetchError(err, url.host), null, 'network')
  }
}

async function readBodyText(res: Response): Promise<string> {
  try { return (await res.text()).slice(0, 400) }
  catch { return '' }
}

function httpError(res: Response, bodyText: string, what: string): MymeetRestError {
  const detail = bodyText ? `: ${bodyText.replace(/\s+/g, ' ').trim()}` : ''
  if (res.status === 401) return new MymeetRestError(`MyMeet: неверный API-ключ (401)${detail}`, 401, 'auth')
  if (res.status === 403) return new MymeetRestError(`MyMeet: доступ запрещён (403 — API доступен на платных тарифах, проверьте права ключа)${detail}`, 403, 'auth')
  if (res.status === 404) return new MymeetRestError(`MyMeet: ${what} не найдена (404) — проверьте ID встречи${detail}`, 404, 'not_found')
  if (res.status === 402) return new MymeetRestError(`MyMeet: исчерпаны минуты тарифа (402)${detail}`, 402, 'quota')
  return new MymeetRestError(`MyMeet: ошибка ${res.status} при запросе «${what}»${detail}`, res.status, 'http')
}

/** GET /api/meeting/status?meeting_id= — plain-text статус (new|queued|processing|processed|failed|…). */
export async function restGetMeetingStatus(apiKey: string, meetingId: string): Promise<string> {
  const res = await restRequest(apiKey, '/api/meeting/status', { meeting_id: meetingId })
  const text = await readBodyText(res)
  if (!res.ok) throw httpError(res, text, 'статус встречи')
  // Иногда статус приходит JSON-строкой в кавычках.
  return text.trim().replace(/^"+|"+$/g, '')
}

export interface RestMeetingReport {
  /** false — MyMeet ещё обрабатывает запись (HTTP 202). */
  ready: boolean
  json: Record<string, unknown> | null
}

/** GET /api/video/report?meeting_id= — полный JSON встречи (транскрипт, спикеры, отчёты). */
export async function restGetMeetingReport(apiKey: string, meetingId: string): Promise<RestMeetingReport> {
  const res = await restRequest(apiKey, '/api/video/report', { meeting_id: meetingId })
  if (res.status === 202) return { ready: false, json: null }
  if (!res.ok) throw httpError(res, await readBodyText(res), 'встреча')
  let json: unknown
  try { json = await res.json() }
  catch { throw new MymeetRestError('MyMeet: отчёт пришёл не в JSON', res.status, 'http') }
  return { ready: true, json: (json && typeof json === 'object') ? json as Record<string, unknown> : { value: json } }
}

export interface RestMeetingListItem {
  id: string
  title: string | null
  date: string | null
  status: string | null
  durationSec: number | null
  link: string | null
}

/**
 * GET /api/workspaces/active/all-meetings (или user-meetings при 403 — ключ участника).
 * Фильтры link/date — точное совпадение (см. API-Docs). page с 0.
 */
export async function restListMeetings(
  apiKey: string,
  opts: { page?: number, perPage?: number, link?: string, date?: string } = {},
): Promise<{ meetings: RestMeetingListItem[], raw: unknown, endpoint: string }> {
  const params = { page: opts.page ?? 0, perPage: opts.perPage ?? 20, link: opts.link, date: opts.date }
  let endpoint = '/api/workspaces/active/all-meetings'
  let res = await restRequest(apiKey, endpoint, params)
  if (res.status === 403) {
    endpoint = '/api/workspaces/active/user-meetings'
    res = await restRequest(apiKey, endpoint, params)
  }
  if (!res.ok) throw httpError(res, await readBodyText(res), 'список встреч')
  const raw = await res.json().catch(() => null) as any
  const arr: any[] = Array.isArray(raw?.followups) ? raw.followups
    : Array.isArray(raw?.meetings) ? raw.meetings
      : Array.isArray(raw?.items) ? raw.items
        : Array.isArray(raw) ? raw : []
  const meetings = arr.map((m): RestMeetingListItem => ({
    id: String(m?.id ?? m?.meeting_id ?? m?.uuid ?? ''),
    title: typeof m?.title === 'string' ? m.title : (typeof m?.name === 'string' ? m.name : null),
    date: typeof m?.date === 'string' ? m.date : (typeof m?.created_at === 'string' ? m.created_at : null),
    status: typeof m?.status === 'string' ? m.status : null,
    durationSec: typeof m?.duration === 'number' ? m.duration : (typeof m?.duration_sec === 'number' ? m.duration_sec : null),
    link: typeof m?.link === 'string' ? m.link : null,
  })).filter(m => m.id)
  return { meetings, raw, endpoint }
}

/**
 * «Пинг» REST с ключом: дешёвый запрос списка встреч на 1 элемент.
 * ok=true означает: хост доступен И ключ принят.
 */
export async function restPing(apiKey: string): Promise<{ ok: true, endpoint: string } | { ok: false, error: string }> {
  try {
    const r = await restListMeetings(apiKey, { page: 0, perPage: 1 })
    return { ok: true, endpoint: r.endpoint }
  }
  catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// ─── Толерантное извлечение данных из JSON отчёта ─────────────────────────────

const TRANSCRIPT_KEYS = ['transcript', 'transcription', 'segments', 'utterances', 'dialogue', 'phrases', 'sentences', 'speech']
const SPEAKER_KEYS = ['speaker', 'speaker_name', 'speakerName', 'name', 'author']
const TEXT_KEYS = ['text', 'content', 'phrase', 'sentence']
const START_KEYS = ['start', 'start_time', 'startTime', 'timestamp', 'offset', 'from']

function firstString(obj: any, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj?.[k]
    if (typeof v === 'string' && v.trim()) return v
  }
  return undefined
}
function firstNumber(obj: any, keys: string[]): number | undefined {
  for (const k of keys) {
    const v = obj?.[k]
    if (typeof v === 'number' && Number.isFinite(v)) return v
    if (typeof v === 'string' && /^\d+(\.\d+)?$/.test(v)) return Number(v)
  }
  return undefined
}

function fmtTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60
  const mm = String(m).padStart(2, '0'), ss = String(r).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

/** Массив реплик → текст «[mm:ss] Спикер: фраза». Null, если это не похоже на транскрипт. */
function segmentsToText(arr: unknown[]): string | null {
  if (!arr.length) return null
  const lines: string[] = []
  let withText = 0
  for (const item of arr) {
    if (typeof item === 'string') { if (item.trim()) { lines.push(item.trim()); withText++ } continue }
    if (!item || typeof item !== 'object') continue
    const text = firstString(item, TEXT_KEYS)
    if (!text) continue
    withText++
    const speaker = firstString(item, SPEAKER_KEYS)
    const start = firstNumber(item, START_KEYS)
    // Время у MyMeet может быть в мс — если > 24ч в секундах, считаем мс.
    const startSec = start === undefined ? undefined : (start > 86_400 ? start / 1000 : start)
    const prefix = [startSec !== undefined ? `[${fmtTime(startSec)}]` : '', speaker ? `${speaker}:` : ''].filter(Boolean).join(' ')
    lines.push(prefix ? `${prefix} ${text.trim()}` : text.trim())
  }
  // Защита от «массива чего угодно»: минимум половина элементов должны быть репликами.
  if (withText === 0 || withText < arr.length / 2) return null
  return lines.join('\n')
}

/**
 * Достаёт текст транскрипта из JSON отчёта MyMeet.
 * Порядок: известные ключи на верхнем уровне → вложенные объекты (глубина ≤ 3) →
 * любой массив объектов с полем text (+ speaker/start). Возвращает null, если не нашли.
 */
export function extractTranscriptFromReport(json: unknown): string | null {
  const visit = (node: unknown, depth: number): string | null => {
    if (!node || typeof node !== 'object' || depth > 3) return null
    const obj = node as Record<string, unknown>
    // 1) Прямые ключи.
    for (const k of TRANSCRIPT_KEYS) {
      const v = obj[k]
      if (typeof v === 'string' && v.trim().length > 20) return v.trim()
      if (Array.isArray(v)) { const t = segmentsToText(v); if (t) return t }
      if (v && typeof v === 'object') {
        // { transcript: { segments: [...] } } / { transcript: { text: '...' } }
        const inner = v as Record<string, unknown>
        const txt = firstString(inner, ['text', 'full_text', 'fullText', 'plain'])
        if (txt && txt.length > 20) return txt
        for (const kk of TRANSCRIPT_KEYS) {
          if (Array.isArray(inner[kk])) { const t = segmentsToText(inner[kk] as unknown[]); if (t) return t }
        }
      }
    }
    // 2) Вложенные объекты.
    for (const v of Object.values(obj)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        const t = visit(v, depth + 1)
        if (t) return t
      }
    }
    // 3) Любой массив реплик.
    for (const v of Object.values(obj)) {
      if (Array.isArray(v) && v.length >= 2 && v.every(i => i && typeof i === 'object')) {
        const looksLikeSpeech = v.some(i => firstString(i, TEXT_KEYS) && (firstString(i, SPEAKER_KEYS) || firstNumber(i, START_KEYS) !== undefined))
        if (looksLikeSpeech) { const t = segmentsToText(v); if (t) return t }
      }
    }
    return null
  }
  return visit(json, 0)
}

/** Краткое резюме: summary/overview на верхнем уровне или внутри followup_v2.templates[]. */
export function extractSummaryFromReport(json: unknown): string | undefined {
  if (!json || typeof json !== 'object') return undefined
  const obj = json as any
  const direct = firstString(obj, ['summary', 'overview', 'abstract', 'short_summary'])
  if (direct) return direct
  const templates: any[] = Array.isArray(obj?.followup_v2?.templates) ? obj.followup_v2.templates
    : Array.isArray(obj?.templates) ? obj.templates : []
  for (const t of templates) {
    const s = firstString(t, ['summary', 'overview', 'text', 'content'])
    if (s) return s
    if (Array.isArray(t?.sections)) {
      for (const sec of t.sections) {
        const name = String(sec?.name ?? sec?.title ?? '').toLowerCase()
        const s2 = firstString(sec, ['text', 'content', 'summary'])
        if (s2 && (name.includes('summary') || name.includes('резюме') || name.includes('итог'))) return s2
      }
      const any = t.sections.map((s: any) => firstString(s, ['text', 'content'])).find(Boolean)
      if (any) return any
    }
  }
  const nested = firstString(obj?.report ?? obj?.followup ?? {}, ['summary', 'overview', 'text'])
  return nested
}

export function extractTitleFromReport(json: unknown): string | undefined {
  return firstString(json as any, ['title', 'name', 'meeting_title', 'meetingTitle'])
}

export function extractDurationSecFromReport(json: unknown): number | undefined {
  const obj = json as any
  const sec = firstNumber(obj, ['duration_sec', 'durationSeconds', 'duration_seconds'])
  if (sec !== undefined) return Math.round(sec)
  const d = firstNumber(obj, ['duration'])
  if (d === undefined) return undefined
  // duration > 24ч в секундах → это миллисекунды.
  return Math.round(d > 86_400 ? d / 1000 : d)
}

export function extractParticipantsFromReport(json: unknown): unknown[] | undefined {
  const obj = json as any
  for (const k of ['participants', 'speakers', 'attendees']) {
    if (Array.isArray(obj?.[k]) && obj[k].length) return obj[k]
  }
  return undefined
}
