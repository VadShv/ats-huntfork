/**
 * GET /api/hh/auto-respond/rules
 *
 * List auto-respond rules for the current org.
 */
import { eq, asc } from 'drizzle-orm'
import { hhAutoRespondRule } from '../../../../database/schema'

export default defineEventHandler(async (event) => {
  const { session } = await requirePermission(event, { hhAutoRespond: ['read'] })
  const orgId = session.activeOrganizationId

  const rules = await db
    .select()
    .from(hhAutoRespondRule)
    .where(eq(hhAutoRespondRule.organizationId, orgId))
    .orderBy(asc(hhAutoRespondRule.priority))

  return rules
})
