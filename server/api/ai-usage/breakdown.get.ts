/**
 * GET /api/ai-usage/breakdown?by=operation|feature|model|config|user|job|trigger
 * Строки таблиц «Операции» и вкладок разрезов (docs/tz-ai-usage.md §8.1, блоки 3–4).
 */
import { breakdownQuerySchema, getBreakdown } from '../../utils/ai/usage/breakdown'
import { requireAiUsageAccess, resolveUsageFilters, stripCosts } from '../../utils/ai/usage/query'

export default defineEventHandler(async (event) => {
  const access = await requireAiUsageAccess(event)
  const q = await getValidatedQuery(event, breakdownQuerySchema.parse)
  const f = resolveUsageFilters(q, access)
  const result = await getBreakdown(access.orgId, f, q.by, q.limit)
  return stripCosts(result, access.canViewCosts)
})
