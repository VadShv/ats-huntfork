/**
 * GET /api/ai-usage/events?cursor&limit — журнал вызовов (docs/tz-ai-usage.md §8.1, блок 6).
 */
import { z } from 'zod'
import { listEvents } from '../../utils/ai/usage/events'
import { requireAiUsageAccess, resolveUsageFilters, stripCosts, usageFilterSchema } from '../../utils/ai/usage/query'

const schema = usageFilterSchema.extend({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})

export default defineEventHandler(async (event) => {
  const access = await requireAiUsageAccess(event)
  const q = await getValidatedQuery(event, schema.parse)
  const f = resolveUsageFilters(q, access)
  const page = await listEvents(access.orgId, f, { cursor: q.cursor, limit: q.limit })
  return stripCosts(page, access.canViewCosts)
})
