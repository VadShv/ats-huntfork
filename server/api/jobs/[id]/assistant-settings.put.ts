import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { commsJobAssistantSettings, job } from '../../../database/schema'
import { idParamSchema } from '../../../utils/schemas/job'

const bodySchema = z.object({
  enabled: z.boolean(),
  goals: z.string().trim().max(10000).nullable().optional(),
  extraContext: z.string().trim().max(20000).nullable().optional(),
  toneOverride: z.enum(['formal', 'neutral', 'friendly']).nullable().optional(),
  defaultAssistantMode: z.enum(['off', 'copilot', 'autopilot_review', 'autopilot']),
})

/**
 * PUT /api/jobs/:id/assistant-settings — upsert настроек ИИ-чата вакансии (Чат 2.0).
 * Влияет на промпт ассистента в диалогах этой вакансии и на режим
 * по умолчанию для НОВЫХ диалогов (существующие не трогаем).
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { job: ['update'] })
  const orgId = session.session.activeOrganizationId
  const { id } = await getValidatedRouterParams(event, idParamSchema.parse)
  const body = await readValidatedBody(event, bodySchema.parse)

  const existingJob = await db.query.job.findFirst({
    where: and(eq(job.id, id), eq(job.organizationId, orgId)),
    columns: { id: true },
  })
  if (!existingJob) {
    throw createError({ statusCode: 404, statusMessage: 'Вакансия не найдена' })
  }

  const values = {
    enabled: body.enabled,
    goals: body.goals || null,
    extraContext: body.extraContext || null,
    toneOverride: body.toneOverride ?? null,
    defaultAssistantMode: body.defaultAssistantMode,
    updatedAt: new Date(),
  }

  const existing = await db.query.commsJobAssistantSettings.findFirst({
    where: eq(commsJobAssistantSettings.jobId, id),
    columns: { id: true },
  })

  if (existing) {
    await db.update(commsJobAssistantSettings).set(values).where(eq(commsJobAssistantSettings.id, existing.id))
  }
  else {
    await db.insert(commsJobAssistantSettings).values({
      organizationId: orgId,
      jobId: id,
      ...values,
    })
  }

  recordActivity({
    organizationId: orgId,
    actorId: session.user.id,
    action: 'updated',
    resourceType: 'job',
    resourceId: id,
    metadata: { assistant_settings: true, default_assistant_mode: body.defaultAssistantMode, enabled: body.enabled },
  })

  return { ok: true }
})
