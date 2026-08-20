/**
 * П7 Sidekick: типизированный протокол сообщений панель ↔ service worker.
 *
 * Discriminated union по полю `type` — вместо прежнего `msg: any`.
 * Каждый вариант описывает контракт конкретного хэндлера background.ts.
 */

/** Единый конверт ответа service worker'а. */
export interface ApiResult<T = any> {
  ok: boolean
  status?: number
  code?: string
  message?: string
  data?: T
}

// ─── Сессия и вакансии ───────────────────────────────────────────────
export interface SessionMsg { type: 'session' }
export interface JobsMsg { type: 'jobs' }
export interface ActiveTabMsg { type: 'activeTab' }
export interface OpenHuntforkMsg { type: 'openHuntfork', url?: string }

// ─── hh.ru: проверка и импорт ────────────────────────────────────────
export interface CheckMsg { type: 'check', resumeIds?: string[], urls?: string[] }
export interface ImportMsg { type: 'import', resumeId?: string, url?: string, jobId?: string }

// ─── Universal Capture ───────────────────────────────────────────────
export interface CapturePageMsg { type: 'capturePage', tabId: number }
export interface CaptureParseMsg { type: 'captureParse', payload: Record<string, unknown> }
export interface CaptureConfirmMsg { type: 'captureConfirm', payload: Record<string, unknown> }

// ─── Sidekick: контекст страницы ─────────────────────────────────────
export interface LookupMsg { type: 'lookup', url: string }
export interface PromptsMsg { type: 'prompts' }
export interface NoteMsg { type: 'note', candidateId: string, body: string }
export interface PdfTextMsg { type: 'pdfText', url: string }

// ─── Лента сорсинга ──────────────────────────────────────────────────
export interface SourcingFeedMsg {
  type: 'sourcingFeed'
  jobId: string
  state?: string
  savedSearchId?: string
  limit?: number
  offset?: number
}
export interface SourcingActionMsg { type: 'sourcingAction', id: string, action: string, note?: string }
export interface SourcingEnrichMsg { type: 'sourcingEnrich', id: string }
export interface SourcingImportMsg { type: 'sourcingImport', id: string }

// ─── П2: read-only канбан воронки ────────────────────────────────────
export interface PipelineMsg { type: 'pipeline', jobId: string }

// ─── П5: шаблоны аутрича, статистика, пакетная обработка очереди ─────
export interface OutreachTemplatesMsg { type: 'outreachTemplates' }
export interface StatsMsg { type: 'stats' }
export interface QueueProcessItemMsg { type: 'queueProcessItem', url: string, jobId?: string }

// ─── П4/П6: серверный ИИ ─────────────────────────────────────────────
export interface VerificationRunMsg {
  type: 'verificationRun'
  text: string
  title?: string
  sourceUrl?: string
  jobId?: string
}
export interface InterviewCardMsg {
  type: 'interviewCard'
  text: string
  title?: string
  sourceUrl?: string
  jobId?: string
  focus?: string
}
export interface SearchMapMsg {
  type: 'searchMap'
  jobId?: string
  title?: string
  description?: string
}

/** Событие от background к панели (broadcast, без ответа). */
export interface TabUrlChangedMsg { type: 'tabUrlChanged', url: string, tabId: number }

export type SidekickMessage
  = | SessionMsg
    | JobsMsg
    | ActiveTabMsg
    | OpenHuntforkMsg
    | CheckMsg
    | ImportMsg
    | CapturePageMsg
    | CaptureParseMsg
    | CaptureConfirmMsg
    | LookupMsg
    | PromptsMsg
    | NoteMsg
    | PdfTextMsg
    | SourcingFeedMsg
    | SourcingActionMsg
    | SourcingEnrichMsg
    | SourcingImportMsg
    | PipelineMsg
    | OutreachTemplatesMsg
    | StatsMsg
    | QueueProcessItemMsg
    | VerificationRunMsg
    | InterviewCardMsg
    | SearchMapMsg
