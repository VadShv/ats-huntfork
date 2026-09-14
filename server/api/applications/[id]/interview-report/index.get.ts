import { and, eq, desc } from 'drizzle-orm'
import { requireApplicationInScope } from '../../../../utils/access/scope'
import { meetingReport } from '../../../../database/schema'
import { applicationIdParamSchema } from '../../../../utils/schemas/reportTemplate'

/**
 * GET /api/applications/:id/interview-report — последний отчёт по отклику
 * (оба source: mymeet | assistant). interview:['read'].
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { interview: ['read'] })
  const orgId = session.session.activeOrganizationId
  const { id: applicationId } = await getValidatedRouterParams(event, applicationIdParamSchema.parse)
  await requireApplicationInScope(event, applicationId as string, orgId)

  const report = await db.query.meetingReport.findFirst({
    where: and(eq(meetingReport.applicationId, applicationId), eq(meetingReport.organizationId, orgId)),
    orderBy: [desc(meetingReport.createdAt)],
  })
  return { report: report ?? null }
})
