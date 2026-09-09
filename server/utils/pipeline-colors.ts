import {
  ALL_STAGE_TYPES,
  STAGE_TYPE_META,
  bucketForStageType as metaBucketForStageType,
  colorForStageType as metaColorForStageType,
  isTerminalStageType,
  type PipelineStageType as MetaPipelineStageType,
  type StageBucket as MetaStageBucket,
} from '../../shared/pipeline-stage-meta'

/**
 * Цвета/bucket/терминальность типов этапов.
 *
 * C4: ВСЁ здесь производно от единого источника `#shared/pipeline-stage-meta`.
 * Публичный API файла сохранён (STAGE_COLORS, BUCKET_BY_TYPE, TERMINAL_TYPES,
 * colorForStageType, bucketForStageType, isTerminalType) — потребители не меняются.
 */

export type PipelineStageType = MetaPipelineStageType
export type StageBucket = MetaStageBucket

/** Канонические hex-цвета для каждого типа этапа (из STAGE_TYPE_META). */
export const STAGE_COLORS: Record<PipelineStageType, string> = Object.fromEntries(
  ALL_STAGE_TYPES.map(t => [t, STAGE_TYPE_META[t].color]),
) as Record<PipelineStageType, string>

/** Каноническая принадлежность типа этапа к bucket (из STAGE_TYPE_META). */
export const BUCKET_BY_TYPE: Record<PipelineStageType, StageBucket> = Object.fromEntries(
  ALL_STAGE_TYPES.map(t => [t, STAGE_TYPE_META[t].bucket]),
) as Record<PipelineStageType, StageBucket>

/**
 * Терминальные типы (hired + все reject-типы). При этих типах isTerminal=true.
 */
export const TERMINAL_TYPES: ReadonlySet<PipelineStageType> = new Set<PipelineStageType>(
  ALL_STAGE_TYPES.filter(t => STAGE_TYPE_META[t].isTerminal),
)

/**
 * Returns the canonical hex color for a given stage type.
 * Falls back to the `custom` color if the type is unrecognized.
 */
export function colorForStageType(type: PipelineStageType): string {
  return metaColorForStageType(type)
}

/**
 * Возвращает bucket для типа этапа. Для custom-этапов возвращает 'working' как безопасный дефолт;
 * реальное значение хранится в колонке `pipelineStage.bucket`.
 */
export function bucketForStageType(type: PipelineStageType): StageBucket {
  return metaBucketForStageType(type)
}

/**
 * Терминальный ли этап данного типа.
 */
export function isTerminalType(type: PipelineStageType): boolean {
  return isTerminalStageType(type)
}
