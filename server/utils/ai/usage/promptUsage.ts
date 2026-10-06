/**
 * Блок «Использование» в Банке промптов (docs/tz-ai-usage.md §8.4): статистика
 * операций за 30 дней, сопоставленная с записями реестра промптов.
 */
import type { H3Event } from 'h3'
import { AI_OPERATIONS } from '../../../../shared/aiUsage/catalog'
import type { ProductionPrompt } from '../promptRegistry'
import { operationStats30d } from './breakdown'
import { requireAiUsageAccess, stripCosts } from './query'

export interface PromptUsage30d {
  operations: string[]
  calls: number
  traces: number
  cost: number
  avgInputTokens: number
  avgOutputTokens: number
  topModel: string | null
  versions: number
  lastAt: string | null
}

/** Ключи операций, которые относятся к записи реестра (сама запись, её подпромпты, promptId). */
export function operationsForPrompt(p: ProductionPrompt): string[] {
  const ids = new Set<string>([p.id, ...(p.subPrompts?.map(s => s.id) ?? []), ...(p.usageOperations ?? [])])
  for (const o of AI_OPERATIONS) if (o.promptId && ids.has(o.promptId)) ids.add(o.key)
  return [...ids].filter(k => AI_OPERATIONS.some(o => o.key === k))
}

/** null — у пользователя нет доступа к расходу ИИ (поле просто не показываем). */
export async function loadPromptUsage(event: H3Event) {
  let access
  try {
    access = await requireAiUsageAccess(event)
  }
  catch {
    return null
  }
  const stats = await operationStats30d(access.orgId, access.canViewOrg ? null : access.userId)
  return {
    canViewCosts: access.canViewCosts,
    currency: access.currency.baseCurrency,
    forPrompt(p: ProductionPrompt): PromptUsage30d {
      const ops = operationsForPrompt(p)
      let calls = 0, traces = 0, cost = 0, inSum = 0, outSum = 0, versions = 0
      let lastAt: string | null = null
      let topModel: string | null = null
      let topCalls = -1
      for (const k of ops) {
        const s = stats.get(k)
        if (!s) continue
        calls += s.calls
        traces += s.traces
        cost += s.cost
        inSum += s.avgInputTokens * s.calls
        outSum += s.avgOutputTokens * s.calls
        versions += s.versions
        if (s.calls > topCalls) { topCalls = s.calls; topModel = s.topModel }
        if (s.lastAt && (!lastAt || s.lastAt > lastAt)) lastAt = s.lastAt
      }
      const usage: PromptUsage30d = {
        operations: ops,
        calls,
        traces,
        cost,
        avgInputTokens: calls ? Math.round(inSum / calls) : 0,
        avgOutputTokens: calls ? Math.round(outSum / calls) : 0,
        topModel,
        versions,
        lastAt,
      }
      return stripCosts(usage, access.canViewCosts)
    },
  }
}
