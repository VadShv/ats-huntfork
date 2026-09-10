import { eq, and } from 'drizzle-orm'
import { z } from 'zod'
import { messageTemplate } from '../../../database/schema'

const updateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  body: z.string().min(1).max(5000).optional(),
  category: z.string().max(50).optional(),
})

export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { application: ['update'] })
  const orgId = session.session.activeOrganizationId
  const id = getRouterParam(event, 'id')!
  const body = await readValidatedBody(event, updateSchema.parse)

  const [updated] = await db.update(messageTemplate)
    .set({ ...body, updatedAt: new Date() })
    .where(and(eq(messageTemplate.id, id), eq(messageTemplate.organizationId, orgId)))
    .returning()

  if (!updated) throw createError({ statusCode: 404, statusMessage: 'Шаблон не найден' })
  return updated
})
