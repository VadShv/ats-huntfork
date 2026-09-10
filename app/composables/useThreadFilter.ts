/**
 * Thread filter logic — reduces noise in busy threads.
 * Filters RenderUnits by category: all, comments, internal, ai, events.
 */
import { ref, computed, type Ref } from 'vue'
import type { RenderUnit } from './useCommentGroups'

export type ThreadFilter = 'all' | 'comments' | 'internal' | 'ai' | 'events'

const AI_KINDS = new Set(['ai_response', 'ai_summary', 'ai_screening_snapshot', 'risk_snapshot'])

export function useThreadFilter(units: Ref<RenderUnit[]>) {
  const active = ref<ThreadFilter>('all')

  const filtered = computed<RenderUnit[]>(() => {
    if (active.value === 'all') return units.value

    return units.value.filter(unit => {
      if (active.value === 'events') return unit.type === 'standalone' && unit.item.type === 'stage_event'
      if (active.value === 'ai') {
        return unit.type === 'standalone' && unit.item.type === 'comment' && unit.item.comment.kind != null && AI_KINDS.has(unit.item.comment.kind)
      }
      if (active.value === 'comments') {
        if (unit.type === 'group') return unit.comments.some(c => !c.isInternal)
        return unit.type === 'standalone' && unit.item.type === 'comment' && (unit.item.comment.kind == null || unit.item.comment.kind === 'text') && !unit.item.comment.isInternal
      }
      if (active.value === 'internal') {
        if (unit.type === 'group') return unit.comments.some(c => c.isInternal)
        return unit.type === 'standalone' && unit.item.type === 'comment' && unit.item.comment.isInternal
      }
      return true
    })
  })

  /** Count per filter for badges. */
  const counts = computed(() => {
    let comments = 0, internal = 0, ai = 0, events = 0
    for (const unit of units.value) {
      if (unit.type === 'stage_event' || (unit.type === 'standalone' && unit.item.type === 'stage_event')) {
        events++
        continue
      }
      if (unit.type === 'group') {
        for (const c of unit.comments) {
          if (c.isInternal) internal++
          else comments++
        }
        continue
      }
      if (unit.type === 'standalone' && unit.item.type === 'comment') {
        const c = unit.item.comment
        if (c.kind != null && AI_KINDS.has(c.kind)) ai++
        else if (c.isInternal) internal++
        else comments++
      }
    }
    return { comments, internal, ai, events }
  })

  return { active, filtered, counts }
}
