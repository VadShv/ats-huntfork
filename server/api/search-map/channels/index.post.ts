import { eq, and } from 'drizzle-orm'
import { z } from 'zod'
import { sourcingChannel } from '../../../database/schema/app'

const createChannelSchema = z.object({
  name: z.string().min(1).max(100).trim(),
  description: z.string().max(500).nullish(),
  defaultPriority: z.enum(['high', 'medium', 'low']).optional().default('medium'),
  urlTemplate: z.string().max(500).nullish(),
  queryLanguageHint: z.string().max(1000).nullish(),
  targetSite: z.string().max(200).nullish(),
})

/**
 * POST /api/search-map/channels — создать custom-канал.
 * Право: searchMap:manage_registry
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { searchMap: ['manage_registry'] })
  const orgId = session.session.activeOrganizationId
  const body = await readValidatedBody(event, createChannelSchema.parse)

  const slug = body.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'custom'
  const code = `custom:${slug}`

  const [existing] = await db.select({ id: sourcingChannel.id }).from(sourcingChannel)
    .where(and(eq(sourcingChannel.organizationId, orgId), eq(sourcingChannel.code, code))).limit(1)
  if (existing) throw createError({ statusCode: 409, statusMessage: 'Канал с таким кодом уже существует' })

  const [created] = await db.insert(sourcingChannel).values({
    organizationId: orgId,
    code,
    name: body.name,
    description: body.description ?? null,
    defaultPriority: body.defaultPriority,
    urlTemplate: body.urlTemplate ?? null,
    queryLanguageHint: body.queryLanguageHint ?? null,
    targetSite: body.targetSite ?? null,
    isSystem: false,
    isActive: true,
  }).returning()

  setResponseStatus(event, 201)
  return created
})
