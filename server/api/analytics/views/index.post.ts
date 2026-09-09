import { z } from 'zod'
import { db } from '../../../utils/db'
import { analyticsSavedView } from '../../../database/schema'

const bodySchema = z.object({
  name: z.string().min(1).max(100),
  filters: z.record(z.string(), z.string()),
})

/** POST /api/analytics/views — сохранить текущие фильтры как пресет. */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { application: ['read'], sourceTracking: ['read'] })
  const orgId = session.session.activeOrganizationId

  const body = await readValidatedBody(event, bodySchema.parse)

  const [created] = await db.insert(analyticsSavedView).values({
    organizationId: orgId,
    userId: session.user.id,
    name: body.name,
    filters: body.filters,
  }).returning({
    id: analyticsSavedView.id,
    name: analyticsSavedView.name,
    filters: analyticsSavedView.filters,
    createdAt: analyticsSavedView.createdAt,
  })

  setResponseStatus(event, 201)
  return created
})
