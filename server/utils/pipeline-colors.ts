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
 */
export const STAGE_COLORS: Record<PipelineStageType, string> = {
  applied: '#94a3b8',   // slate-400
  screening: '#3b82f6', // blue-500
  interview: '#a855f7', // purple-500
  offer: '#eab308',     // yellow-500
  hired: '#10b981',     // emerald-500
  rejected: '#ef4444',  // red-500
  custom: '#06b6d4',    // cyan-500
}

/**
 * Returns the canonical hex color for a given stage type.
 * Falls back to the `custom` color if the type is unrecognized.
 */
export function colorForStageType(type: PipelineStageType): string {
  return STAGE_COLORS[type] ?? STAGE_COLORS.custom
}
