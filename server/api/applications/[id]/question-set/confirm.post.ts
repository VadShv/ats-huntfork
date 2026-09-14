import { and, eq } from 'drizzle-orm'
import { requireApplicationInScope } from '../../../../utils/access/scope'
import { application, applicationQuestionSet } from '../../../../database/schema'
import { applicationIdParamSchema } from '../../../../utils/schemas/candidateQuestions'

/**
 * POST /api/applications/:id/question-set/confirm
 * Зафиксировать текущий активный черновик как иммутабельный snapshot.
 * После этого regenerate создаёт новую версию, не затирая snapshot. application:['update'].
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { application: ['update'] })
  const orgId = session.session.activeOrganizationId
  const { id: applicationId } = await getValidatedRouterParams(event, applicationIdParamSchema.parse)
  await requireApplicationInScope(event, applicationId as string, orgId)

  const app = await db.query.application.findFirst({
    where: and(eq(application.id, applicationId), eq(application.organizationId, orgId)),
    columns: { id: true },
  })
  if (!app) throw createError({ statusCode: 404, statusMessage: 'Отклик не найден' })

  const active = await db.query.applicationQuestionSet.findFirst({
    where: and(
      eq(applicationQuestionSet.applicationId, applicationId),
      eq(applicationQuestionSet.organizationId, orgId),
      eq(applicationQuestionSet.isSnapshot, false),
    ),
    columns: { id: true, version: true },
  })
  if (!active) throw createError({ statusCode: 404, statusMessage: 'Нет активного опросника для фиксации' })

  const [snapshot] = await db.update(applicationQuestionSet)
    .set({ isSnapshot: true, confirmedAt: new Date(), confirmedById: session.user.id })
    .where(eq(applicationQuestionSet.id, active.id))
    .returning()

  return snapshot
})
