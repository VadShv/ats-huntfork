import { and, eq } from 'drizzle-orm'
import { job } from '../../../database/schema'
import { idParamSchema } from '../../../utils/schemas/job'
import { getJobAssistantSettings } from '../../../utils/comms/assistant'

/**
 * GET /api/jobs/:id/assistant-settings — настройки ИИ-чата вакансии (Чат 2.0).
 * Дополняют глобальный профиль суфлёра: цели общения, доп. контекст,
 * переопределение тона и режим ассистента по умолчанию для новых диалогов.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { job: ['read'] })
  const orgId = session.session.activeOrganizationId
  const { id } = await getValidatedRouterParams(event, idParamSchema.parse)

  const existingJob = await db.query.job.findFirst({
    where: and(eq(job.id, id), eq(job.organizationId, orgId)),
    columns: { id: true },
  })
  if (!existingJob) {
    throw createError({ statusCode: 404, statusMessage: 'Вакансия не найдена' })
  }

  const settings = await getJobAssistantSettings(id)
  return {
    settings: {
      enabled: settings?.enabled ?? true,
      goals: settings?.goals ?? null,
      extraContext: settings?.extraContext ?? null,
      toneOverride: settings?.toneOverride ?? null,
      defaultAssistantMode: settings?.defaultAssistantMode ?? 'off',
    },
  }
})
