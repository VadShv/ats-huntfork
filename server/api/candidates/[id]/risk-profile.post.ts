import { and, eq, desc } from 'drizzle-orm'
import { candidate, candidateResumeVersion } from '../../../database/schema'
import { candidateIdParamSchema, triggerRiskSchema } from '../../../utils/schemas/risk'
import { enqueueResumeRisk } from '../../../utils/risk/worker'
import { createRateLimiter } from '../../../utils/rateLimit'

const limiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 20,
  message: 'Слишком много запусков риск-анализа. Подождите немного',
})

/**
 * POST /api/candidates/:id/risk-profile
 *
 * Enqueues a risk assessment for the candidate's current resume version.
 * Uses scoring:create (same family as ai-summary / analyze).
 */
export default defineEventHandler(async (event) => {
  await limiter(event)
  const session = await requirePermission(event, { scoring: ['create'] })
  const orgId = session.session.activeOrganizationId

  const { id } = await getValidatedRouterParams(event, candidateIdParamSchema.parse)
  const body = await readValidatedBody(event, triggerRiskSchema.parse)

  const candidateRow = await db.query.candidate.findFirst({
    where: and(eq(candidate.id, id), eq(candidate.organizationId, orgId)),
    columns: { id: true },
  })
  if (!candidateRow) {
    throw createError({ statusCode: 404, statusMessage: 'Кандидат не найден' })
  }

  const current = await db.query.candidateResumeVersion.findFirst({
    where: and(eq(candidateResumeVersion.candidateId, id), eq(candidateResumeVersion.isCurrent, true)),
    columns: { id: true },
  })
  const version = current ?? await db.query.candidateResumeVersion.findFirst({
    where: eq(candidateResumeVersion.candidateId, id),
    orderBy: [desc(candidateResumeVersion.versionNumber)],
    columns: { id: true },
  })

  if (!version) {
    throw createError({ statusCode: 422, statusMessage: 'У кандидата нет версии резюме для анализа' })
  }

  await enqueueResumeRisk({
    organizationId: orgId,
    candidateId: id,
    resumeVersionId: version.id,
    triggeredById: session.user.id,
    force: body.force,
  })

  return { candidateId: id, resumeVersionId: version.id, status: 'queued' }
})
