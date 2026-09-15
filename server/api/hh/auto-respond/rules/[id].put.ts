/**
 * PUT /api/hh/auto-respond/rules/:id
 *
 * Update an existing auto-respond rule.
 */
import { and, eq } from 'drizzle-orm'
import { hhAutoRespondRule } from '../../../../database/schema'

export default defineEventHandler(async (event) => {
  const { session } = await requirePermission(event, { hhAutoRespond: ['update'] })
  const orgId = session.activeOrganizationId
  const ruleId = getRouterParam(event, 'id')

  if (!ruleId) {
    throw createError({ statusCode: 400, statusMessage: 'Не указан ID правила' })
  }

  const [existing] = await db
    .select()
    .from(hhAutoRespondRule)
    .where(and(eq(hhAutoRespondRule.id, ruleId), eq(hhAutoRespondRule.organizationId, orgId)))
    .limit(1)
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Правило не найдено' })
  }

  const body = await readBody<{
    name?: string
    triggerCollection?: string
    triggerDelayMinutes?: number
    condition?: Record<string, unknown>
    messageTemplate?: string
    isActive?: boolean
    priority?: number
  }>(event)

  const updates: Record<string, unknown> = { updatedAt: new Date() }
  if (body?.name !== undefined) updates.name = body.name.trim()
  if (body?.triggerCollection !== undefined) updates.triggerCollection = body.triggerCollection.trim()
  if (body?.triggerDelayMinutes !== undefined) updates.triggerDelayMinutes = body.triggerDelayMinutes
  if (body?.condition !== undefined) updates.condition = body.condition
  if (body?.messageTemplate !== undefined) updates.messageTemplate = body.messageTemplate.trim()
  if (body?.isActive !== undefined) updates.isActive = body.isActive
  if (body?.priority !== undefined) updates.priority = body.priority

  const [updated] = await db
    .update(hhAutoRespondRule)
    .set(updates)
    .where(eq(hhAutoRespondRule.id, ruleId))
    .returning()

  return updated
})
