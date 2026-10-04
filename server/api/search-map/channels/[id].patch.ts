import { eq, and } from 'drizzle-orm'
import { z } from 'zod'
import { sourcingChannel } from '../../../database/schema/app'

const idParamSchema = z.object({ id: z.string().min(1) })
const patchChannelSchema = z.object({
  name: z.string().min(1).max(100).trim().optional(),
  description: z.string().max(500).nullish(),
  defaultPriority: z.enum(['high', 'medium', 'low']).optional(),
  urlTemplate: z.string().max(500).nullish(),
  queryLanguageHint: z.string().max(1000).nullish(),
  targetSite: z.string().max(200).nullish(),
  isActive: z.boolean().optional(),
}).strict()

/**
 * PATCH /api/search-map/channels/[id] — правка канала.
 * Право: searchMap:manage_registry. Системным нельзя менять code.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { searchMap: ['manage_registry'] })
  const orgId = session.session.activeOrganizationId
  const { id } = await getValidatedRouterParams(event, idParamSchema.parse)
  const body = await readValidatedBody(event, patchChannelSchema.parse)

  const [existing] = await db.select().from(sourcingChannel)
    .where(and(eq(sourcingChannel.id, id), eq(sourcingChannel.organizationId, orgId))).limit(1)
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Канал не найден' })

  const patch: Record<string, unknown> = { updatedAt: new Date() }
  for (const [k, v] of Object.entries(body)) {
    if (v !== undefined) patch[k] = v
  }

  const [updated] = await db.update(sourcingChannel).set(patch)
    .where(and(eq(sourcingChannel.id, id), eq(sourcingChannel.organizationId, orgId)))
    .returning()

  return updated
})
