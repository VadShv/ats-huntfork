/**
 * Общее in-memory хранилище асинхронных батчей прогона.
 * Разделяется между search-batch.post.ts и search-batch/[batchId].get.ts.
 */
import type { SearchOutcome } from './types'

export interface BatchState {
  id: string
  /** Организация-владелец — чужие батчи опрашивать нельзя. */
  orgId: string
  total: number
  results: Record<string, SearchOutcome>
  done: number
  status: 'running' | 'complete' | 'error'
  startedAt: number
}

/** Глобальное хранилище батчей — переживает весь процесс. */
export const batchStore = new Map<string, BatchState>()

export function getBatchState(batchId: string): BatchState | undefined {
  return batchStore.get(batchId)
}
