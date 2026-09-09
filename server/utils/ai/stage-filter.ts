import { and, eq, inArray } from 'drizzle-orm'
import { pipelineStage } from '../../database/schema'
import type { PipelineStageType } from '../../../shared/pipeline-stage-meta'

// Accept any Drizzle DB instance (server Proxy-wrapped db or raw drizzle).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = any

export interface StageFilterInput {
  /** Точный id этапа воронки. Захватывает сам этап + все его подэтапы. */
  stageId?: string
  /** Канонический тип этапа. Захватывает ВСЕ этапы этого типа в орг. */
  stageType?: PipelineStageType
}

/**
 * Резолвит этапный фильтр ИИ-инструментов в набор `current_stage_id`.
 *
 * Единый источник для list_applications и search_candidates (W2.2) — чтобы
 * оба фильтровали по РЕАЛЬНОМУ этапу (current_stage_id), а не по legacy
 * `application.status` (6 корзин, схлопывающих разные этапы).
 *
 * Возвращает:
 *   - `string[]` — id этапов для фильтра `inArray(current_stage_id, ids)`.
 *     Пустой массив [] означает «фильтр задан, но подходящих этапов нет» →
 *     вызывающий код должен вернуть пустой результат (НЕ откатываться на legacy).
 *   - `null` — этапный фильтр не задан (ни stageId, ни stageType) → вызывающий
 *     код может применить legacy `status`-фильтр (back-compat).
 */
export async function resolveStageFilterIds(
  db: DB,
  organizationId: string,
  input: StageFilterInput,
): Promise<string[] | null> {
  if (input.stageId) {
    // Сам этап + его подэтапы (например «Отказ» → все причины отказа).
    const children: Array<{ id: string }> = await db
      .select({ id: pipelineStage.id })
      .from(pipelineStage)
      .where(and(
        eq(pipelineStage.organizationId, organizationId),
        eq(pipelineStage.parentStageId, input.stageId),
      ))
    return [...new Set([input.stageId, ...children.map(c => c.id)])]
  }

  if (input.stageType) {
    const typed: Array<{ id: string }> = await db
      .select({ id: pipelineStage.id })
      .from(pipelineStage)
      .where(and(
        eq(pipelineStage.organizationId, organizationId),
        eq(pipelineStage.type, input.stageType),
      ))
    return typed.map(s => s.id)
  }

  return null
}
