/**
 * Shared validation helpers for pipeline stage rules.
 * Used by POST, PATCH and stage PATCH endpoints.
 *
 * Модель hh.ru 1-в-1:
 * - Этапы делятся на bucket'ы: 'working' и 'rejected'.
 * - Каждый этап имеет type из 16 значений (new, on_hold, contact, screening,
 *   assessment, interview, offer, hired, not_fit, withdrawn, no_show,
 *   job_closed, transferred, applied [legacy], rejected [legacy], custom).
 * - Системные этапы (isSystemStage=true) — read-only: их нельзя переименовать,
 *   удалить, изменить bucket/type/parent. Только скрыть (isHidden=true) или
 *   переупорядочить (displayOrder).
 * - Подстатусы: parentStageId ссылается на родительский этап. Максимум 1 уровень
 *   вложенности (у подстатуса не может быть своих подстатусов).
 */

// ─────────────────────────────────────────────────────────────
// Type constants (соответствуют pipeline_stage_type enum в БД)
// ─────────────────────────────────────────────────────────────

export const WORKING_TYPES = [
  'new', 'on_hold', 'contact', 'screening', 'assessment',
  'interview', 'offer', 'hired',
] as const

export const REJECTED_TYPES = [
  'not_fit', 'withdrawn', 'no_show', 'job_closed', 'transferred',
  'rejected', // legacy
] as const

export const LEGACY_TYPES = ['applied', 'rejected'] as const
export const CUSTOM_TYPES = ['custom'] as const

/** Все допустимые типы этапов — совпадает с pipeline_stage_type enum в БД. */
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

/**
 * Определяет корректный bucket по type.
 * Custom — определяется на уровне записи в БД (bucket явно задан).
 */
export function bucketForType(type: PipelineStageType): StageBucket | 'custom' {
  if ((REJECTED_TYPES as readonly string[]).includes(type)) return 'rejected'
  if ((WORKING_TYPES as readonly string[]).includes(type)) return 'working'
  if (type === 'applied') return 'working'  // legacy → working
  if (type === 'rejected') return 'rejected'
  return 'custom'
}

/** Является ли тип терминальным по умолчанию. */
export function isTerminalTypeDefault(type: PipelineStageType): boolean {
  return type === 'hired' || (REJECTED_TYPES as readonly string[]).includes(type)
}

// ─────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────

export interface StageInput {
  id?: string
  name: string
  type: string
  isTerminal: boolean
  isArchived?: boolean
  isHidden?: boolean
  bucket?: StageBucket
  parentStageId?: string | null
  isSystemStage?: boolean
}

/**
 * Валидирует набор этапов воронки против бизнес-правил.
 *
 * Учитываются только НЕ архивные и НЕ скрытые этапы для структурных проверок:
 * скрытие/архивация не должны ломать required constraints.
 *
 * Правила:
 * - минимум 2 этапа в working bucket (кроме архивных и скрытых)
 * - минимум 1 rejected этап (кроме архивных и скрытых)
 * - имена уникальны в пределах одного родителя (или на верхнем уровне)
 * - подстатусы: parentStageId должен ссылаться на существующий этап без родителя
 *   (максимум 1 уровень вложенности)
 * - подстатус наследует bucket от родителя
 *
 * Throws createError({ statusCode: 400 }) с русским сообщением при ошибке.
 */
export function validatePipelineStages(stages: StageInput[]): void {
  const activeVisible = stages.filter((s) => !s.isArchived && !s.isHidden)

  // ── Спринт 22 (F4): legacy-типы нельзя назначать НОВЫМ этапам ───────
  // 'applied' — полностью legacy; 'rejected' зарезервирован за системным
  // родителем «Отказ» (создаётся миграцией/сидом, не через API).
  // Существующие этапы (с id) проходят без ограничений (round-trip редактора).
  for (const s of stages) {
    if (!s.id && (LEGACY_TYPES as readonly string[]).includes(s.type) && !s.isSystemStage) {
      throw createError({
        statusCode: 400,
        statusMessage: `Тип этапа «${s.type}» — устаревший и недоступен для новых этапов. Используйте «custom» или один из актуальных типов`,
      })
    }
  }

  // ── Минимум 2 активных working этапа ─────────────────────────────
  const workingActive = activeVisible.filter((s) => {
    const bucket = s.bucket ?? bucketForType(s.type as PipelineStageType)
    return bucket === 'working'
  })
  if (workingActive.length < 2) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Воронка должна содержать минимум 2 активных этапа в разделе «В работе»',
    })
  }

  // ── Минимум 1 rejected этап ──────────────────────────────────────
  const rejectedActive = activeVisible.filter((s) => {
    const bucket = s.bucket ?? bucketForType(s.type as PipelineStageType)
    return bucket === 'rejected'
  })
  if (rejectedActive.length < 1) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Воронка должна содержать минимум 1 этап отказа',
    })
  }

  // ── Проверка иерархии подстатусов (макс. 1 уровень) ──────────────
  const idToStage = new Map<string, StageInput>()
  for (const s of stages) {
    if (s.id) idToStage.set(s.id, s)
  }

  for (const s of stages) {
    if (!s.parentStageId) continue
    const parent = idToStage.get(s.parentStageId)
    if (!parent) {
      throw createError({
        statusCode: 400,
        statusMessage: `Родительский этап для «${s.name}» не найден`,
      })
    }
    if (parent.parentStageId) {
      throw createError({
        statusCode: 400,
        statusMessage: `Подстатус «${s.name}» не может ссылаться на другой подстатус («${parent.name}»). Максимум 1 уровень вложенности`,
      })
    }
    // Bucket подстатуса должен совпадать с родительским
    const parentBucket = parent.bucket ?? bucketForType(parent.type as PipelineStageType)
    const stageBucket = s.bucket ?? bucketForType(s.type as PipelineStageType)
    if (parentBucket !== stageBucket && stageBucket !== 'custom') {
      throw createError({
        statusCode: 400,
        statusMessage: `Подстатус «${s.name}» должен быть в том же разделе, что и родительский этап «${parent.name}»`,
      })
    }
  }

  // ── Уникальность имён в пределах одного родителя ─────────────────
  // Родитель null → верхний уровень.
  const nameByParent = new Map<string, Set<string>>()
  for (const s of activeVisible) {
    const parentKey = s.parentStageId ?? '__root__'
    let seen = nameByParent.get(parentKey)
    if (!seen) {
      seen = new Set<string>()
      nameByParent.set(parentKey, seen)
    }
    const key = s.name.trim().toLowerCase()
    if (seen.has(key)) {
      throw createError({
        statusCode: 400,
        statusMessage: `Этапы с одинаковым именем «${s.name}» на одном уровне не допускаются`,
      })
    }
    seen.add(key)
  }
}
