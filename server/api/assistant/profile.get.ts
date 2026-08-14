import { eq } from 'drizzle-orm'
import { aiConfig } from '../../database/schema'
import { getAssistantProfile } from '../../utils/comms/assistant'

/**
 * GET /api/assistant/profile — профиль AI-ассистента переписки (Спринт 18.5)
 * + список AI-конфигов организации для выбора провайдера/модели.
 */
export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const orgId = session.session.activeOrganizationId

  const [profile, configs] = await Promise.all([
    getAssistantProfile(orgId),
    db.select({
      id: aiConfig.id,
      name: aiConfig.name,
      provider: aiConfig.provider,
      model: aiConfig.model,
    }).from(aiConfig).where(eq(aiConfig.organizationId, orgId)),
  ])

  return {
    profile: profile
      ? {
          enabled: profile.enabled,
          personaName: profile.personaName,
          personaRole: profile.personaRole,
          tone: profile.tone,
          language: profile.language,
          knowledgeBase: profile.knowledgeBase,
          rules: profile.rules,
          signatureEnabled: profile.signatureEnabled,
          aiConfigId: profile.aiConfigId,
        }
      : null,
    configs,
  }
})
