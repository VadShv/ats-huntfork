import { eq } from 'drizzle-orm'
import { riskPolicy } from '../../database/schema'

/**
 * GET /api/org-settings/risk-policy
 * Returns the org risk policy, or defaults when not yet configured.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { organization: ['read'] })
  const orgId = session.session.activeOrganizationId

  const row = await db.query.riskPolicy.findFirst({
    where: eq(riskPolicy.organizationId, orgId),
  })

  return row ?? {
    organizationId: orgId,
    shortStintMonths: 12,
    jobHoppingMediumScore: 40,
    jobHoppingHighScore: 65,
    capLinguisticToMedium: true,
    extraInstructions: null,
    isDefault: true,
  }
})
