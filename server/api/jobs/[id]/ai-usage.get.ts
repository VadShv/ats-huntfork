/**
 * GET /api/jobs/:id/ai-usage — «ИИ по вакансии: X ₽ · N вызовов» (docs/tz-ai-usage.md §8.3).
 */
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { aiUsageEvent } from '../../../database/schema'
import { embedSummary } from '../../../utils/ai/usage/embed'
import { requireAiUsageAccess } from '../../../utils/ai/usage/query'

export default defineEventHandler(async (event) => {
  const access = await requireAiUsageAccess(event)
  const { id } = await getValidatedRouterParams(event, z.object({ id: z.string().min(1) }).parse)
  await requireJobInScope(event, id)
  return embedSummary(access, eq(aiUsageEvent.jobId, id))
})
