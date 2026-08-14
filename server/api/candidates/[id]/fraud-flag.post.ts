import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { candidate } from '../../../database/schema'
import { candidateIdParamSchema } from '../../../utils/schemas/candidate'
import { setFraudFlagManually } from '../../../utils/fraud/detect'

const bodySchema = z.object({
  flag: z.boolean(),
  reason: z.string().max(200).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
})

/**
 * POST /api/candidates/:id/fraud-flag
 *
 * Ручное выставление или снятие фрод-флага для кандидата.
 * Доступно при candidate:update.
 *
 * Body:
 *   { flag: true,  reason?: 'blacklist'|'security_incident'|...|свободный текст, notes?: '...' }
 *   { flag: false }
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { candidate: ['update'] })
  const orgId = session.session.activeOrganizationId
  const userId = session.user.id
  const { id } = await getValidatedRouterParams(event, candidateIdParamSchema.parse)
  const body = await readValidatedBody(event, bodySchema.parse)

  // Проверка принадлежности
  const me = await db.query.candidate.findFirst({
    where: and(eq(candidate.id, id), eq(candidate.organizationId, orgId)),
    columns: { id: true, fraudFlag: true, fraudReason: true },
  })
  if (!me) {
    throw createError({ statusCode: 404, statusMessage: 'Кандидат не найден' })
  }

  await setFraudFlagManually({
    candidateId: id,
    flag: body.flag,
    reason: body.reason ?? null,
    notes: body.notes ?? null,
    userId,
  })

  const [updated] = await db
    .select({
      id: candidate.id,
      fraudFlag: candidate.fraudFlag,
      fraudReason: candidate.fraudReason,
      fraudFlaggedAt: candidate.fraudFlaggedAt,
      fraudFlaggedByUserId: candidate.fraudFlaggedByUserId,
      fraudNotes: candidate.fraudNotes,
    })
    .from(candidate)
    .where(eq(candidate.id, id))
    .limit(1)

  return {
    ok: true,
    candidate: updated,
  }
})
