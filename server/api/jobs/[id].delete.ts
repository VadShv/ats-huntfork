import { eq, and } from 'drizzle-orm'
import { job } from '../../database/schema'
import { idParamSchema } from '../../utils/schemas/job'
import { getActorContext } from '../../utils/access/actorContext'
import { isJobInScope } from '../../utils/access/scope'

export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { job: ['delete'] })
  const orgId = session.session.activeOrganizationId
  const actor = await getActorContext(event)

  const { id } = await getValidatedRouterParams(event, idParamSchema.parse)

  // Scope guard (RBAC v2 — "private jobs"): out-of-scope job → 404.
  if (actor && !(await isJobInScope(actor, id))) {
    throw createError({ statusCode: 404, statusMessage: 'Вакансия не найдена' })
  }

  const [deleted] = await db.delete(job)
    .where(and(eq(job.id, id), eq(job.organizationId, orgId)))
    .returning({ id: job.id })

  if (!deleted) {
    throw createError({ statusCode: 404, statusMessage: 'Вакансия не найдена' })
  }

  recordActivity({
    organizationId: orgId,
    actorId: session.user.id,
    action: 'deleted',
    resourceType: 'job',
    resourceId: id,
  })

  setResponseStatus(event, 204)
  return null
})
