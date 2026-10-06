/**
 * GET /api/candidates/:id/ai-usage — «ИИ по кандидату: X ₽» (разбор резюме, риски, сводка,
 * верификация, скрининг его откликов) — docs/tz-ai-usage.md §8.3.
 */
import { and, eq, inArray, or } from 'drizzle-orm'
import { z } from 'zod'
import { aiUsageEvent, application } from '../../../database/schema'
import { embedSummary } from '../../../utils/ai/usage/embed'
import { requireAiUsageAccess } from '../../../utils/ai/usage/query'

export default defineEventHandler(async (event) => {
  const access = await requireAiUsageAccess(event)
  const { id } = await getValidatedRouterParams(event, z.object({ id: z.string().min(1) }).parse)
  await requireCandidateInScope(event, id)
  const apps = await db.select({ id: application.id }).from(application)
    .where(and(eq(application.candidateId, id), eq(application.organizationId, access.orgId)))
  const e = aiUsageEvent
  const scope = or(
    and(eq(e.entityType, 'candidate'), eq(e.entityId, id)),
    apps.length ? and(eq(e.entityType, 'application'), inArray(e.entityId, apps.map(a => a.id))) : undefined,
  )!
  return embedSummary(access, scope)
})
