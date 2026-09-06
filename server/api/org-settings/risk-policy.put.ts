import { eq } from 'drizzle-orm'
import { riskPolicy } from '../../database/schema'
import { updateRiskPolicySchema } from '../../utils/schemas/risk'

/**
 * PUT /api/org-settings/risk-policy
 * Upsert the org risk policy (bounded). Requires organization:update.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { organization: ['update'] })
  const orgId = session.session.activeOrganizationId

  const body = await readValidatedBody(event, updateRiskPolicySchema.parse)
  const now = new Date()

  const [result] = await db
    .insert(riskPolicy)
    .values({
      organizationId: orgId,
      shortStintMonths: body.shortStintMonths ?? 12,
      jobHoppingMediumScore: body.jobHoppingMediumScore ?? 40,
      jobHoppingHighScore: body.jobHoppingHighScore ?? 65,
      capLinguisticToMedium: body.capLinguisticToMedium ?? true,
      extraInstructions: body.extraInstructions ?? null,
    })
    .onConflictDoUpdate({
      target: riskPolicy.organizationId,
      set: {
        ...(body.shortStintMonths !== undefined && { shortStintMonths: body.shortStintMonths }),
        ...(body.jobHoppingMediumScore !== undefined && { jobHoppingMediumScore: body.jobHoppingMediumScore }),
        ...(body.jobHoppingHighScore !== undefined && { jobHoppingHighScore: body.jobHoppingHighScore }),
        ...(body.capLinguisticToMedium !== undefined && { capLinguisticToMedium: body.capLinguisticToMedium }),
        ...(body.extraInstructions !== undefined && { extraInstructions: body.extraInstructions ?? null }),
        updatedAt: now,
      },
    })
    .returning()

  return result
})
