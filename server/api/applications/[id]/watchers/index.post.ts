import { and, eq } from 'drizzle-orm'
import { application } from '../../../../database/schema/app'
import { member } from '../../../../database/schema/auth'
import { applicationIdParamSchema } from '../../../../utils/schemas/application'
import { watcherAddSchema } from '../../../../utils/schemas/applicationComment'
import { ensureWatcher } from '../../../../utils/comments/ensure-watcher'

/**
 * POST /api/applications/:id/watchers
 * Manually subscribe a user (must be active org member) to thread updates.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { application: ['update'] })
  const orgId = session.session.activeOrganizationId

  const { id } = await getValidatedRouterParams(event, applicationIdParamSchema.parse)
  const body = await readValidatedBody(event, watcherAddSchema.parse)

  const app = await db.query.application.findFirst({
    where: and(eq(application.id, id), eq(application.organizationId, orgId)),
    columns: { id: true },
  })
  if (!app) throw createError({ statusCode: 404, statusMessage: 'Отклик не найден' })

  // verify target is an active member of the org
  const mem = await db.query.member.findFirst({
    where: and(eq(member.organizationId, orgId), eq(member.userId, body.userId)),
    columns: { userId: true, status: true },
  })
  if (!mem || mem.status !== 'active') {
    throw createError({ statusCode: 400, statusMessage: 'Пользователь не активный член организации' })
  }

  await ensureWatcher(db, {
    organizationId: orgId,
    applicationId: id,
    userId: body.userId,
    source: 'manual',
  })

  setResponseStatus(event, 201)
  return { userId: body.userId, source: 'manual' as const }
})
