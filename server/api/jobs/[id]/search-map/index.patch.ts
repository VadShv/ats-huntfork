import { eq, and } from 'drizzle-orm'
import { z } from 'zod'
import { jobSearchMap } from '../../../../database/schema/app'

const idParamSchema = z.object({ id: z.string().min(1) })
const patchMapSchema = z.object({
  summary: z.string().max(2000).nullish(),
  status: z.enum(['draft', 'active', 'archived']).optional(),
}).strict()

/**
 * PATCH /api/jobs/[id]/search-map — обновить summary/status.
 * Право: searchMap:edit
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { searchMap: ['edit'] })
  const orgId = session.session.activeOrganizationId
  const { id: jobId } = await getValidatedRouterParams(event, idParamSchema.parse)
  const body = await readValidatedBody(event, patchMapSchema.parse)
  await requireJobInScope(event, jobId)

  const patch: Record<string, unknown> = { updatedAt: new Date() }
  if (body.summary !== undefined) patch.summary = body.summary
  if (body.status !== undefined) patch.status = body.status

  const [updated] = await db.update(jobSearchMap).set(patch)
    .where(and(eq(jobSearchMap.jobId, jobId), eq(jobSearchMap.organizationId, orgId)))
    .returning()
  if (!updated) throw createError({ statusCode: 404, statusMessage: 'Карта не найдена' })

  return updated
})
