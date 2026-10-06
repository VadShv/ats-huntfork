/**
 * GET /api/jobs/:id/search-map/ai-usage — «Генерация: N запусков · X ₽ · последний Y с»
 * и средняя цена действия по каждой части за 30 дней (docs/tz-ai-usage.md §8.3).
 */
import { and, eq, like } from 'drizzle-orm'
import { z } from 'zod'
import { aiUsageEvent } from '../../../../database/schema'
import { embedSummary } from '../../../../utils/ai/usage/embed'
import { requireAiUsageAccess } from '../../../../utils/ai/usage/query'

export default defineEventHandler(async (event) => {
  const access = await requireAiUsageAccess(event)
  const { id } = await getValidatedRouterParams(event, z.object({ id: z.string().min(1) }).parse)
  await requireJobInScope(event, id)
  const e = aiUsageEvent
  const [forJob, typical] = await Promise.all([
    embedSummary(access, and(eq(e.jobId, id), like(e.operation, 'searchMap.%'))!),
    // «обычно ≈ Z ₽» — средняя стоимость действия по организации за 30 дней.
    embedSummary(access, like(e.operation, 'searchMap.%'), { days: 30 }),
  ])
  return { ...forJob, typical: typical.operations }
})
