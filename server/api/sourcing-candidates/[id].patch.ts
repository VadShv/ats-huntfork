/**
 * PATCH /api/sourcing-candidates/:id
 *
 * Изменить состояние/заметку кандидата сорсинга.
 *
 * Действия (через `action`):
 *   - reject     → state='rejected'
 *   - approve    → state='approved'
 *   - markReviewed → state='reviewed'
 *
 * Поле note (reviewNote) можно обновлять отдельно.
 *
 * Импорт в воронку — отдельный endpoint POST /import (создаёт application + candidate).
 * Открытие контакта — отдельный endpoint POST /open-contact (тратит квоту hh).
 */
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { hhSourcingCandidate } from '../../database/schema'

const paramsSchema = z.object({ id: z.string().min(1) })

const bodySchema = z
  .object({
    action: z.enum(['reject', 'approve', 'markReviewed']).optional(),
    note: z.string().max(2000).nullable().optional(),
  })
  .strict()
  .refine((v) => v.action !== undefined || v.note !== undefined, {
    message: 'Нужно указать action или note',
  })

export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { job: ['update'] })
  const orgId = session.session.activeOrganizationId
  const userId = session.user.id
  const { id } = await getValidatedRouterParams(event, paramsSchema.parse)
  const body = await readValidatedBody(event, bodySchema.parse)

  const existing = await db.query.hhSourcingCandidate.findFirst({
    where: and(eq(hhSourcingCandidate.id, id), eq(hhSourcingCandidate.organizationId, orgId)),
    columns: { id: true, state: true },
  })
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Кандидат не найден' })
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() }

  if (body.action) {
    const stateMap = {
      reject: 'rejected',
      approve: 'approved',
      markReviewed: 'reviewed',
    } as const
    updates.state = stateMap[body.action]
    updates.reviewedByUserId = userId
    updates.reviewedAt = new Date()
  }

  if (body.note !== undefined) {
    updates.reviewNote = body.note
  }

  await db
    .update(hhSourcingCandidate)
    .set(updates)
    .where(and(eq(hhSourcingCandidate.id, id), eq(hhSourcingCandidate.organizationId, orgId)))

  return { id, updated: true, state: updates.state ?? existing.state }
})
