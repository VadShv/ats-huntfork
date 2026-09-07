import { and, eq, desc } from 'drizzle-orm'
import { interview, meetingReport } from '../../../database/schema'
import { interviewIdParamSchema } from '../../../utils/schemas/mymeet'

/**
 * GET /api/interviews/:id/meeting-report
 * Returns the latest MyMeet report linked to the interview, or null.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { interview: ['read'] })
  const orgId = session.session.activeOrganizationId

  const { id: interviewId } = await getValidatedRouterParams(event, interviewIdParamSchema.parse)

  const iv = await db.query.interview.findFirst({
    where: eq(interview.id, interviewId),
    columns: { id: true },
    with: { application: { columns: { organizationId: true } } },
  })
  if (!iv || (iv.application as any)?.organizationId !== orgId) {
    throw createError({ statusCode: 404, statusMessage: 'Интервью не найдено' })
  }

  const report = await db.query.meetingReport.findFirst({
    where: and(eq(meetingReport.interviewId, interviewId), eq(meetingReport.organizationId, orgId)),
    orderBy: [desc(meetingReport.createdAt)],
  })

  return report ?? null
})
