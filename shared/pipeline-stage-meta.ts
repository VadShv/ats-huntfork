/**
 * Единый источник истины для семантики типов этапов воронки (pipeline_stage_type).
 *
 * Раньше семантика «тип → X» была размазана по 4 несогласованным картам:
 *   - stageTypeToLegacyStatus  (server/utils/pipeline-move.ts)      — тип → legacy application.status
 *   - stageTypeToHhCollection  (server/utils/hh/sourcing/pushAction.ts) — тип → коллекция hh.ru
 *   - BUCKET_BY_TYPE           (server/utils/pipeline-colors.ts)    — тип → bucket
 *   - LEGACY_STATUS_TO_TYPES   (app/.../applications/index.vue)     — legacy status → типы (инверсия)
 *
 * Новый/переименованный тип «тихо проваливался» во всех четырёх. Теперь все они
 * ПРОИЗВОДНЫ от STAGE_TYPE_META — добавление типа требует ровно одной правки здесь,
 * а unit-тест-инвариант (tests/unit/pipeline-stage-meta.test.ts) не даёт забыть поле.
 *
 * ВАЖНО: четыре оси независимы. Нельзя схлопывать их в одну классификацию —
 * есть намеренные асимметрии, которые обязаны сохраниться:
 *   - `transferred`: legacyStatus='rejected', но hhCollection=null (перевод — НЕ отказ,
 *     авто-discard отправил бы кандидату отказное сообщение на hh).
 *   - `hired`: bucket='working' (для аналитики воронки), но isTerminal=true, isSuccess=true.
 *   - `on_hold`/`contact`/`assessment`: legacyStatus='screening' (одна корзина),
 *     но разные hhCollection (разная гранулярность).
 *   - `custom`: legacyStatus=null и hhCollection=null (статус «замерзает», push не идёт),
 *     bucket='working' по умолчанию (реальный bucket хранится в колонке).
 */

/** Все значения enum pipeline_stage_type (совпадает с БД и Drizzle-энумом). */
export const ALL_STAGE_TYPES = [
  // working
  'new', 'on_hold', 'contact', 'screening', 'assessment',
  'interview', 'offer', 'hired',
  // rejected
  'not_fit', 'withdrawn', 'no_show', 'job_closed', 'transferred',
  // legacy retro-compat
  'applied', 'rejected',
  // user-defined
  'custom',
] as const

export type PipelineStageType = typeof ALL_STAGE_TYPES[number]
export type StageBucket = 'working' | 'rejected'

/** Legacy application.status enum (6 значений). Проекция типа этапа на старую ось. */
export type LegacyApplicationStatus =
  | 'new' | 'screening' | 'interview' | 'offer' | 'hired' | 'rejected'

/** Коллекции hh.ru (fallback, когда нет явного hh_stage_mapping). */
export type HhCollection =
  | 'consider' | 'phone_interview' | 'assessment'
  | 'interview' | 'offer' | 'hired' | 'discard_by_employer'

export interface StageTypeMeta {
  /** Проекция на legacy application.status. null — статус «замирает» (custom без родителя). */
  legacyStatus: LegacyApplicationStatus | null
  /** Fallback-коллекция hh.ru. null — не пушим (входные этапы, перевод, custom, неизвестное). */
  hhCollection: HhCollection | null
  /** Bucket по умолчанию. Для `custom` реальный bucket берётся из колонки pipelineStage.bucket. */
  bucket: StageBucket
  /** Терминальный ли этап (найм или отказ). */
  isTerminal: boolean
  /** Успешно-терминальный (только `hired`). */
  isSuccess: boolean
  /** Цвет по умолчанию (hex). */
  color: string
}

/**
 * КАНОНИЧЕСКАЯ ТАБЛИЦА. Порядок ключей соответствует ALL_STAGE_TYPES.
 * Изменение семантики любого типа — только здесь.
 */
export const STAGE_TYPE_META: Record<PipelineStageType, StageTypeMeta> = {
  // ── Working bucket ──
  new:        { legacyStatus: 'new',       hhCollection: null,                bucket: 'working',  isTerminal: false, isSuccess: false, color: '#94a3b8' },
  on_hold:    { legacyStatus: 'screening', hhCollection: 'consider',          bucket: 'working',  isTerminal: false, isSuccess: false, color: '#a8a29e' },
  contact:    { legacyStatus: 'screening', hhCollection: 'phone_interview',   bucket: 'working',  isTerminal: false, isSuccess: false, color: '#0ea5e9' },
  screening:  { legacyStatus: 'screening', hhCollection: 'consider',          bucket: 'working',  isTerminal: false, isSuccess: false, color: '#3b82f6' },
  assessment: { legacyStatus: 'screening', hhCollection: 'assessment',        bucket: 'working',  isTerminal: false, isSuccess: false, color: '#6366f1' },
  interview:  { legacyStatus: 'interview', hhCollection: 'interview',         bucket: 'working',  isTerminal: false, isSuccess: false, color: '#a855f7' },
  offer:      { legacyStatus: 'offer',     hhCollection: 'offer',             bucket: 'working',  isTerminal: false, isSuccess: false, color: '#eab308' },
  // ── Terminal success (bucket остаётся working для аналитики) ──
  hired:      { legacyStatus: 'hired',     hhCollection: 'hired',             bucket: 'working',  isTerminal: true,  isSuccess: true,  color: '#10b981' },
  // ── Terminal reject ──
  not_fit:    { legacyStatus: 'rejected',  hhCollection: 'discard_by_employer', bucket: 'rejected', isTerminal: true, isSuccess: false, color: '#ef4444' },
  withdrawn:  { legacyStatus: 'rejected',  hhCollection: 'discard_by_employer', bucket: 'rejected', isTerminal: true, isSuccess: false, color: '#f87171' },
  no_show:    { legacyStatus: 'rejected',  hhCollection: 'discard_by_employer', bucket: 'rejected', isTerminal: true, isSuccess: false, color: '#e11d48' },
  job_closed: { legacyStatus: 'rejected',  hhCollection: 'discard_by_employer', bucket: 'rejected', isTerminal: true, isSuccess: false, color: '#b91c1c' },
  // Перевод на другую вакансию — НЕ отказ для кандидата: hhCollection=null (не пушим discard).
  transferred:{ legacyStatus: 'rejected',  hhCollection: null,                bucket: 'rejected', isTerminal: true, isSuccess: false, color: '#9f1239' },
  // ── Legacy aliases (retro-compat) ──
  applied:    { legacyStatus: 'new',       hhCollection: null,                bucket: 'working',  isTerminal: false, isSuccess: false, color: '#94a3b8' },
  rejected:   { legacyStatus: 'rejected',  hhCollection: 'discard_by_employer', bucket: 'rejected', isTerminal: true, isSuccess: false, color: '#ef4444' },
  // ── User-defined ──
  custom:     { legacyStatus: null,        hhCollection: null,                bucket: 'working',  isTerminal: false, isSuccess: false, color: '#06b6d4' },
}

/** Тип → legacy application.status (null для custom без проекции). */
export function stageTypeToLegacyStatus(type: string): LegacyApplicationStatus | null {
  return STAGE_TYPE_META[type as PipelineStageType]?.legacyStatus ?? null
}

/** Тип → коллекция hh.ru (null = не пушим). */
export function stageTypeToHhCollection(type: string): HhCollection | null {
  return STAGE_TYPE_META[type as PipelineStageType]?.hhCollection ?? null
}

/** Тип → bucket по умолчанию (для custom — 'working'; реальный bucket в колонке). */
export function bucketForStageType(type: string): StageBucket {
  return STAGE_TYPE_META[type as PipelineStageType]?.bucket ?? 'working'
}

/** Терминальный ли тип по умолчанию (hired + все reject-типы). */
export function isTerminalStageType(type: string): boolean {
  return STAGE_TYPE_META[type as PipelineStageType]?.isTerminal ?? false
}

/** Цвет типа по умолчанию. */
export function colorForStageType(type: string): string {
  return STAGE_TYPE_META[type as PipelineStageType]?.color ?? STAGE_TYPE_META.custom.color
}

/**
 * Эффективный тип этапа для проекции статуса/hh.
 * custom-подэтап наследует тип корневого родителя (например custom-подэтап под
 * «Первичный контакт» (contact) → contact). Все остальные — свой тип.
 * Используется в moveApplicationStage и hh-push.
 */
export function projectEffectiveType(
  stageType: string,
  parentType: string | null | undefined,
): string {
  return stageType === 'custom' && parentType ? parentType : stageType
}

/**
 * Инверсия legacyStatus: legacy application.status → все типы этапов, проецирующиеся в него.
 * Используется для back-compat старых ссылок ?status=<legacy> → фильтр по этапам.
 * Пример: 'screening' → ['on_hold','contact','screening','assessment'].
 */
export const LEGACY_STATUS_TO_TYPES: Record<LegacyApplicationStatus, PipelineStageType[]> = (() => {
  const map: Record<string, PipelineStageType[]> = {
    new: [], screening: [], interview: [], offer: [], hired: [], rejected: [],
  }
  for (const type of ALL_STAGE_TYPES) {
    const ls = STAGE_TYPE_META[type].legacyStatus
    if (ls) (map[ls] ??= []).push(type)
  }
  return map as Record<LegacyApplicationStatus, PipelineStageType[]>
})()
