import { eq, and } from 'drizzle-orm'
import { z } from 'zod'
import { sourcingChannel, jobSearchMapSegment } from '../../../database/schema/app'

const idParamSchema = z.object({ id: z.string().min(1) })

/**
 * DELETE /api/search-map/channels/[id] — удалить канал.
 * Право: searchMap:manage_registry. Системные нельзя удалить (409).
 * Используемый сегментами — 409.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { searchMap: ['manage_registry'] })
  const orgId = session.session.activeOrganizationId
  const { id } = await getValidatedRouterParams(event, idParamSchema.parse)

  const [channel] = await db.select().from(sourcingChannel)
    .where(and(eq(sourcingChannel.id, id), eq(sourcingChannel.organizationId, orgId))).limit(1)
  if (!channel) throw createError({ statusCode: 404, statusMessage: 'Канал не найден' })
  if (channel.isSystem) throw createError({ statusCode: 409, statusMessage: 'Системный канал нельзя удалить; деактивируйте через PATCH isActive=false' })

  const [usedBySegment] = await db.select({ id: jobSearchMapSegment.id }).from(jobSearchMapSegment)
    .where(and(eq(jobSearchMapSegment.channelId, id), eq(jobSearchMapSegment.organizationId, orgId))).limit(1)
  if (usedBySegment) throw createError({ statusCode: 409, statusMessage: 'Канал используется в сегментах карт поиска' })

  await db.delete(sourcingChannel).where(and(eq(sourcingChannel.id, id), eq(sourcingChannel.organizationId, orgId)))

  return { success: true }
})
