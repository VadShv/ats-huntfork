import { z } from 'zod'
import { gamificationSettings } from '../../database/schema'

const bodySchema = z.object({
  mvpEnabled: z.boolean().optional(),
  mvpTelegramChatId: z.string().trim().max(64).nullable().optional(),
})

/** PATCH /api/gamification/settings — MVP-push config (owner/admin). */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { organization: ['update'] })
  const orgId = session.session.activeOrganizationId
  if (!orgId) throw createError({ statusCode: 403, statusMessage: 'Нет активной организации' })
  const body = await readValidatedBody(event, bodySchema.parse)

  const set: Record<string, unknown> = { updatedAt: new Date() }
  if (body.mvpEnabled !== undefined) set.mvpEnabled = body.mvpEnabled
  if (body.mvpTelegramChatId !== undefined) set.mvpTelegramChatId = body.mvpTelegramChatId || null

  await db.insert(gamificationSettings)
    .values({
      organizationId: orgId,
      mvpEnabled: body.mvpEnabled ?? false,
      mvpTelegramChatId: body.mvpTelegramChatId ?? null,
    })
    .onConflictDoUpdate({ target: gamificationSettings.organizationId, set })

  return { success: true }
})
