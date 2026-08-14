import type { pipelineStageTypeEnum } from '../database/schema/app'

/**
 * The inferred TypeScript type for the pipeline_stage_type enum values.
 * Derived directly from the Drizzle enum so it stays in sync automatically.
 */
export type PipelineStageType = typeof pipelineStageTypeEnum.enumValues[number]

/**
 * Canonical hex colors for each pipeline stage type.
 * These are assigned automatically by the server when a stage is created
 * without an explicit color override.
 *
 * Legacy types (applied/screening/rejected) остаются для retro-совместимости
 * с воронками, созданными до модели «1-в-1 с hh.ru».
 */
export const STAGE_COLORS: Record<PipelineStageType, string> = {
  // ── Working bucket ──
  new: '#94a3b8', // slate-400 (Неразобранные)
  on_hold: '#a8a29e', // stone-400 (Подумать)
  contact: '#0ea5e9', // sky-500 (Первичный контакт)
  screening: '#3b82f6', // blue-500 (Скрининг)
  assessment: '#6366f1', // indigo-500 (Тестовое)
  interview: '#a855f7', // purple-500 (Интервью)
  offer: '#eab308', // yellow-500 (Оффер)
  // ── Terminal success ──
  hired: '#10b981', // emerald-500 (Принят)
  // ── Terminal reject ──
  // Спринт 12.4: все отказные этапы — оттенки красного, чтобы визуально
  // отделяться от рабочих этапов в воронке.
  not_fit: '#ef4444', // red-500 (Не подходит)
  withdrawn: '#f87171', // red-400 (Кандидат отказался)
  no_show: '#e11d48', // rose-600 (Не выходит на связь)
  job_closed: '#b91c1c', // red-700 (Вакансия закрыта)
  transferred: '#9f1239', // rose-800 (Перевод на другую)
  // ── Legacy (retro-compat) ──
  applied: '#94a3b8', // slate-400 (alias for `new`)
  rejected: '#ef4444', // red-500 (alias for `not_fit`)
  // ── User-defined ──
  custom: '#06b6d4', // cyan-500
}

/**
 * The two «buckets» a stage can belong to.
 * — `working` — активные этапы (кандидат в процессе)
 * — `rejected` — отказные этапы (кандидат не подошёл или ушёл)
 * `hired` — терминальный, но остаётся в bucket=`working` для аналитики воронки.
 */
export type StageBucket = 'working' | 'rejected'

/**
 * Каноническая принадлежность типа этапа к bucket.
 * Используется при сидинге и как дефолт при создании этапа с известным типом.
 * Для `custom` bucket определяется пользователем.
 */
export const BUCKET_BY_TYPE: Record<PipelineStageType, StageBucket> = {
  new: 'working',
  on_hold: 'working',
  contact: 'working',
  screening: 'working',
  assessment: 'working',
  interview: 'working',
  offer: 'working',
  hired: 'working',
  not_fit: 'rejected',
  withdrawn: 'rejected',
  no_show: 'rejected',
  job_closed: 'rejected',
  transferred: 'rejected',
  applied: 'working', // legacy alias
  rejected: 'rejected', // legacy
  custom: 'working',
}

/**
 * Терминальные типы. При этих типах isTerminal должен быть true.
 * `hired` — success terminal, остальные — reject terminals.
 */
export const TERMINAL_TYPES: ReadonlySet<PipelineStageType> = new Set<PipelineStageType>([
  'hired',
  'not_fit',
  'withdrawn',
  'no_show',
  'job_closed',
  'transferred',
  'rejected', // legacy
])

/**
 * Returns the canonical hex color for a given stage type.
 * Falls back to the `custom` color if the type is unrecognized.
 */
export function colorForStageType(type: PipelineStageType): string {
  return STAGE_COLORS[type] ?? STAGE_COLORS.custom
}

/**
 * Возвращает bucket для типа этапа. Для custom-этапов возвращает 'working' как безопасный дефолт;
 * реальное значение хранится в колонке `pipelineStage.bucket`.
 */
export function bucketForStageType(type: PipelineStageType): StageBucket {
  return BUCKET_BY_TYPE[type] ?? 'working'
}

/**
 * Терминальный ли этап данного типа.
 */
export function isTerminalType(type: PipelineStageType): boolean {
  return TERMINAL_TYPES.has(type)
}
