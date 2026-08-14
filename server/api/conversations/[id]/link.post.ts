/**
 * POST /api/conversations/:id/link — ручная привязка диалога к отклику.
 *
 * Спринт 19.5: business-чаты личного Telegram создаются автоматически и часто
 * не мэтчатся по username — рекрутёр привязывает их к кандидату из Инбокса.
 */
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { application, commsConversation } from '../../../database/schema'

const paramsSchema = z.object({ id: z.string().min(1) })
const bodySchema = z.object({ applicationId: z.string().min(1) })

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const orgId = session.session.activeOrganizationId
  const { id } = await getValidatedRouterParams(event, paramsSchema.parse)
  const body = await readValidatedBody(event, bodySchema.parse)

  const conv = await db.query.commsConversation.findFirst({
    where: and(eq(commsConversation.id, id), eq(commsConversation.organizationId, orgId)),
  })
  if (!conv) {
    throw createError({ statusCode: 404, statusMessage: 'Диалог не найден' })
  }

  const app = await db.query.application.findFirst({
    where: and(eq(application.id, body.applicationId), eq(application.organizationId, orgId)),
    columns: { id: true, candidateId: true, jobId: true },
  })
  if (!app) {
    throw createError({ statusCode: 404, statusMessage: 'Отклик не найден' })
  }

  await db.update(commsConversation)
    .set({
      candidateId: app.candidateId,
      applicationId: app.id,
      jobId: app.jobId,
      updatedAt: new Date(),
    })
    .where(eq(commsConversation.id, conv.id))

  await recordActivity({
    organizationId: orgId,
    actorId: session.user.id,
    action: 'updated',
    resourceType: 'conversation',
    resourceId: conv.id,
    metadata: { linked_application_id: app.id },
  })
  logInfo('comms.conversation_linked', {
    conversation_id: conv.id,
    application_id: app.id,
    organization_id: orgId,
    module: 'comms',
  })

  return { ok: true, applicationId: app.id }
})
