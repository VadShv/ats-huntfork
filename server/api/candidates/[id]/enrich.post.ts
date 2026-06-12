import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { candidate } from '../../../database/schema'

/**
 * P1.3: «Дополнить существующего» — добавляет в карточку существующего кандидата
 * только те поля из переданного draft, которые у существующего ПУСТЫЕ (NULL/'').
 *
 * Поле не перезаписывается, если уже заполнено — это безопасный enrich, не update.
 * Email/firstName/lastName/orgId — никогда не трогаем (это identity).
 *
 * Возвращает diff: что было дополнено.
 */

const enrichBodySchema = z.object({
  phone: z.string().trim().optional().nullable(),
  gender: z.enum(['male', 'female', 'other', 'prefer_not_to_say']).optional().nullable(),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  quickNotes: z.string().max(2000).optional().nullable(),
}).strict()

type EnrichBody = z.infer<typeof enrichBodySchema>

function isEmpty(v: string | null | undefined): boolean {
  return v === null || v === undefined || v.trim?.() === ''
}

export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { candidate: ['update'] })
  const orgId = session.session.activeOrganizationId

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'id обязателен' })
  }

  const body = (await readValidatedBody(event, enrichBodySchema.parse)) as EnrichBody

  // 1. Найти существующего и убедиться, что он наш и активный
  const [existing] = await db.select().from(candidate).where(eq(candidate.id, id)).limit(1)
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Кандидат не найден' })
  }
  if (existing.organizationId !== orgId) {
    throw createError({ statusCode: 403, statusMessage: 'Нет доступа к этому кандидату' })
  }
  if (existing.mergeStatus !== 'active') {
    throw createError({ statusCode: 400, statusMessage: 'Кандидат не активен (был слит)' })
  }

  // 2. Считаем patch — только пустые поля
  const patch: Record<string, unknown> = {}
  const added: string[] = []

  if (body.phone && isEmpty(existing.phone)) {
    patch.phone = body.phone.trim()
    added.push('phone')
  }
  if (body.gender && isEmpty(existing.gender)) {
    patch.gender = body.gender
    added.push('gender')
  }
  if (body.dateOfBirth && isEmpty(existing.dateOfBirth)) {
    patch.dateOfBirth = body.dateOfBirth
    added.push('dateOfBirth')
  }
  if (body.quickNotes && body.quickNotes.trim()) {
    // quickNotes — особый случай: если уже есть, добавляем через '---'
    const trimmed = body.quickNotes.trim()
    if (isEmpty(existing.quickNotes)) {
      patch.quickNotes = trimmed
    }
    else {
      patch.quickNotes = `${existing.quickNotes}\n\n---\n${trimmed}`
    }
    added.push('quickNotes')
  }

  if (added.length === 0) {
    return {
      ok: true as const,
      candidateId: id,
      added: [],
      skipped: ['все поля уже заполнены'],
    }
  }

  // 3. Применить
  ;(patch as any).updatedAt = new Date()
  await db.update(candidate)
    .set(patch)
    .where(and(eq(candidate.id, id), eq(candidate.organizationId, orgId)))

  recordActivity({
    organizationId: orgId,
    actorId: session.user.id,
    action: 'updated',
    resourceType: 'candidate',
    resourceId: id,
    metadata: {
      kind: 'enrich_from_dup',
      added: added.join(','),
    },
  })

  logInfo('dedup.candidate_enriched', {
    candidate_id: id,
    organization_id: orgId,
    actor_id: session.user.id,
    added_fields: added.join(','),
    module: 'dedup',
  })

  return {
    ok: true as const,
    candidateId: id,
    added,
    skipped: [],
  }
})
