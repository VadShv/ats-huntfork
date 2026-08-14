import { eq, and } from 'drizzle-orm'
import { z } from 'zod'
import { aiConfig, commsAssistantProfile } from '../../database/schema'

const bodySchema = z.object({
  enabled: z.boolean(),
  personaName: z.string().trim().max(120).nullable().optional(),
  personaRole: z.string().trim().max(200).nullable().optional(),
  tone: z.enum(['formal', 'neutral', 'friendly']),
  language: z.enum(['ru', 'en']),
  knowledgeBase: z.string().trim().max(20000).nullable().optional(),
  rules: z.string().trim().max(10000).nullable().optional(),
  signatureEnabled: z.boolean(),
  aiConfigId: z.string().min(1).nullable().optional(),
})

/**
 * PUT /api/assistant/profile — upsert профиля AI-ассистента (Спринт 18.5).
 * AI-конфиг ассистента выбирается из существующих ai_config организации
 * (отдельная запись от скрининга — контур скрининга не трогаем).
 */
export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const orgId = session.session.activeOrganizationId
  const body = await readValidatedBody(event, bodySchema.parse)

  // Конфиг должен принадлежать организации
  if (body.aiConfigId) {
    const cfg = await db.query.aiConfig.findFirst({
      where: and(eq(aiConfig.id, body.aiConfigId), eq(aiConfig.organizationId, orgId)),
      columns: { id: true },
    })
    if (!cfg) {
      throw createError({ statusCode: 400, statusMessage: 'Конфигурация ИИ не найдена' })
    }
  }
  if (body.enabled && !body.aiConfigId) {
    throw createError({ statusCode: 400, statusMessage: 'Для включения ассистента требуется конфигурация ИИ' })
  }

  const values = {
    enabled: body.enabled,
    personaName: body.personaName ?? null,
    personaRole: body.personaRole ?? null,
    tone: body.tone,
    language: body.language,
    knowledgeBase: body.knowledgeBase ?? null,
    rules: body.rules ?? null,
    signatureEnabled: body.signatureEnabled,
    aiConfigId: body.aiConfigId ?? null,
    updatedAt: new Date(),
  }

  const existing = await db.query.commsAssistantProfile.findFirst({
    where: eq(commsAssistantProfile.organizationId, orgId),
    columns: { id: true },
  })

  if (existing) {
    await db.update(commsAssistantProfile).set(values).where(eq(commsAssistantProfile.id, existing.id))
  }
  else {
    await db.insert(commsAssistantProfile).values({ organizationId: orgId, ...values })
  }

  logInfo('comms.assistant_profile_saved', { organization_id: orgId, enabled: body.enabled })
  return { ok: true }
})
