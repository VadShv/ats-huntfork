import { and, eq, inArray, isNull } from 'drizzle-orm'
import { notification } from '../../database/schema/app'
import { z } from 'zod'

const markReadSchema = z.object({
  ids: z.array(z.string().min(1)).optional(),
  all: z.boolean().optional().default(false),
})

/**
 * POST /api/notifications/read
 * Marks the specified notifications as read, or all if { all: true }.
 */
export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const orgId = session.session.activeOrganizationId
  const userId = session.user.id
  if (!orgId) throw createError({ statusCode: 400, statusMessage: 'No active organization' })

  const body = await readValidatedBody(event, markReadSchema.parse)

  if (!body.all && (!body.ids || body.ids.length === 0)) {
    throw createError({ statusCode: 400, statusMessage: 'Передайте ids[] или { all: true }' })
  }

  const now = new Date()
  const where = body.all
    ? and(eq(notification.userId, userId), eq(notification.organizationId, orgId), isNull(notification.readAt))
    : and(
        eq(notification.userId, userId),
        eq(notification.organizationId, orgId),
        inArray(notification.id, body.ids!),
        isNull(notification.readAt),
      )

  await db.update(notification).set({ readAt: now }).where(where)
  setResponseStatus(event, 204)
  return null
})
