/**
 * POST /api/dedup/duplicates/:pairId/ai-arbitrate
 *
 * Sprint 5.2 (P5.2): запускает AI-арбитра для конкретной пары.
 * Если пара уже проверена — возвращает кешированный вердикт.
 * При body.force=true перепроверяет.
 */
import { z } from 'zod'
import { arbitrateDuplicatePair } from '../../../../utils/dedup/ai-arbiter'

const bodySchema = z.object({
  force: z.boolean().optional().default(false),
}).optional()

export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { candidate: ['update'] })
  const orgId = session.session.activeOrganizationId

  const pairId = getRouterParam(event, 'pairId')
  if (!pairId) throw createError({ statusCode: 400, statusMessage: 'pairId обязателен' })

  const body = await readValidatedBody(event, b => (b ? bodySchema.parse(b) : undefined))

  const result = await arbitrateDuplicatePair({
    orgId,
    pairId,
    force: body?.force ?? false,
  })

  return result
})
