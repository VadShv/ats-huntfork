/**
 * DELETE /api/hh/auto-respond/rules/:id
 *
 * Delete an auto-respond rule.
 */
import { and, eq } from 'drizzle-orm'
import { hhAutoRespondRule } from '../../../../database/schema'

export default defineEventHandler(async (event) => {
  const { session } = await requirePermission(event, { hhAutoRespond: ['delete'] })
  const orgId = session.activeOrganizationId
  const ruleId = getRouterParam(event, 'id')

  if (!ruleId) {
    throw createError({ statusCode: 400, statusMessage: 'Не указан ID правила' })
  }

  const [existing] = await db
    .select({ id: hhAutoRespondRule.id })
    .from(hhAutoRespondRule)
    .where(and(eq(hhAutoRespondRule.id, ruleId), eq(hhAutoRespondRule.organizationId, orgId)))
    .limit(1)
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Правило не найдено' })
  }

  await db.delete(hhAutoRespondRule).where(eq(hhAutoRespondRule.id, ruleId))

  return { success: true }
})
