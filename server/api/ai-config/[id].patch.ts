import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { aiConfig } from '../../database/schema'
import { updateAiConfigSchema } from '../../utils/schemas/scoring'
import { encrypt } from '../../utils/encryption'
import { invalidateAiPricingCache } from '../../utils/ai/usage/pricing'

const paramsSchema = z.object({ id: z.string().min(1) })

/**
 * PATCH /api/ai-config/:id
 *
 * Update an AI configuration. Re-encrypts the API key only when supplied,
 * so users can edit name / model / pricing without re-entering credentials.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { scoring: ['create'] })
  const orgId = session.session.activeOrganizationId
  const { id } = await getValidatedRouterParams(event, paramsSchema.parse)
  const body = await readValidatedBody(event, updateAiConfigSchema.parse)

  const existing = await db.query.aiConfig.findFirst({
    where: and(eq(aiConfig.id, id), eq(aiConfig.organizationId, orgId)),
    columns: { id: true, inputPricePer1m: true, outputPricePer1m: true, cachedInputPricePer1m: true, priceCurrency: true, model: true },
  })
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Конфигурация ИИ не найдена' })

  const updates: Record<string, unknown> = { updatedAt: new Date() }
  if (body.name !== undefined) updates.name = body.name
  if (body.provider !== undefined) updates.provider = body.provider
  if (body.model !== undefined) updates.model = body.model
  if (body.baseUrl !== undefined) updates.baseUrl = body.baseUrl ?? null
  if (body.maxTokens !== undefined) updates.maxTokens = body.maxTokens
  if (body.inputPricePer1m !== undefined) updates.inputPricePer1m = body.inputPricePer1m != null ? String(body.inputPricePer1m) : null
  if (body.outputPricePer1m !== undefined) updates.outputPricePer1m = body.outputPricePer1m != null ? String(body.outputPricePer1m) : null
  if (body.cachedInputPricePer1m !== undefined) updates.cachedInputPricePer1m = body.cachedInputPricePer1m != null ? String(body.cachedInputPricePer1m) : null
  if (body.priceCurrency !== undefined) updates.priceCurrency = body.priceCurrency
  if (body.apiKey) updates.apiKeyEncrypted = encrypt(body.apiKey, env.BETTER_AUTH_SECRET)

  const [updated] = await db.update(aiConfig)
    .set(updates)
    .where(and(eq(aiConfig.id, id), eq(aiConfig.organizationId, orgId)))
    .returning({
      id: aiConfig.id,
      name: aiConfig.name,
      provider: aiConfig.provider,
      model: aiConfig.model,
      baseUrl: aiConfig.baseUrl,
      maxTokens: aiConfig.maxTokens,
      inputPricePer1m: aiConfig.inputPricePer1m,
      outputPricePer1m: aiConfig.outputPricePer1m,
      cachedInputPricePer1m: aiConfig.cachedInputPricePer1m,
      priceCurrency: aiConfig.priceCurrency,
      isDefaultChatbot: aiConfig.isDefaultChatbot,
      isDefaultAnalysis: aiConfig.isDefaultAnalysis,
      isDefaultStructuring: aiConfig.isDefaultStructuring,
      apiKeyEncrypted: aiConfig.apiKeyEncrypted,
    })

  // Цены фиксируются в событиях на момент вызова — новые вызовы должны брать новые цены.
  invalidateAiPricingCache(orgId)
  const num = (v: unknown) => (v == null ? null : Number(v))
  const priceBefore = {
    inputPricePer1m: num(existing.inputPricePer1m),
    outputPricePer1m: num(existing.outputPricePer1m),
    cachedInputPricePer1m: num(existing.cachedInputPricePer1m),
    priceCurrency: existing.priceCurrency,
  }
  const priceAfter = {
    inputPricePer1m: num(updated!.inputPricePer1m),
    outputPricePer1m: num(updated!.outputPricePer1m),
    cachedInputPricePer1m: num(updated!.cachedInputPricePer1m),
    priceCurrency: updated!.priceCurrency,
  }
  const priceChanged = JSON.stringify(priceBefore) !== JSON.stringify(priceAfter)

  recordActivity({
    organizationId: orgId,
    actorId: session.user.id,
    action: 'updated',
    resourceType: 'aiConfig',
    resourceId: id,
    // Изменение цен — в журнал активности (docs/tz-ai-usage.md §10.3).
    ...(priceChanged ? { before: priceBefore, after: priceAfter, metadata: { priceChanged: true, model: updated!.model } } : {}),
  })

  const { apiKeyEncrypted, ...rest } = updated!
  return {
    config: {
      ...rest,
      inputPricePer1m: rest.inputPricePer1m != null ? Number(rest.inputPricePer1m) : null,
      outputPricePer1m: rest.outputPricePer1m != null ? Number(rest.outputPricePer1m) : null,
      cachedInputPricePer1m: rest.cachedInputPricePer1m != null ? Number(rest.cachedInputPricePer1m) : null,
      hasApiKey: Boolean(apiKeyEncrypted),
    },
  }
})
