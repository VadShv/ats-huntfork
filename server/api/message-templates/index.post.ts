import { z } from 'zod'
import { messageTemplate } from '../../database/schema'

const createSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(5000),
  category: z.string().max(50).default('custom'),
})

export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { application: ['update'] })
  const orgId = session.session.activeOrganizationId
  const body = await readValidatedBody(event, createSchema.parse)

  const [created] = await db.insert(messageTemplate).values({
    organizationId: orgId,
    title: body.title,
    body: body.body,
    category: body.category,
    createdById: session.user.id,
  }).returning()

  return created
})
