import { and, eq } from 'drizzle-orm'
import { interview, application, meetingReport } from '../../../database/schema'
import { interviewIdParamSchema, importMeetingSchema } from '../../../utils/schemas/mymeet'
import { isMymeetConnected } from '../../../utils/mymeet/account'
import { enqueueMymeetImport } from '../../../utils/mymeet/worker'
import { createRateLimiter } from '../../../utils/rateLimit'

const limiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 20,
  message: 'Слишком много импортов MyMeet. Подождите немного',
})

/**
 * POST /api/interviews/:id/import-mymeet
 * Manually link a MyMeet meeting to an interview and enqueue its report import.
 * Body: { externalMeetingId, title?, sourceUrl? }
 */
export default defineEventHandler(async (event) => {
  await limiter(event)
  const session = await requirePermission(event, { interview: ['update'] })
  const orgId = session.session.activeOrganizationId

  const { id: interviewId } = await getValidatedRouterParams(event, interviewIdParamSchema.parse)
  const body = await readValidatedBody(event, importMeetingSchema.parse)

  if (!(await isMymeetConnected(orgId))) {
    throw createError({ statusCode: 422, statusMessage: 'MyMeet не подключён' })
  }

  // Interview ∈ org (via application) + grab applicationId for denormalization.
  const iv = await db.query.interview.findFirst({
    where: eq(interview.id, interviewId),
    columns: { id: true, applicationId: true },
    with: { application: { columns: { id: true, organizationId: true } } },
  })
  if (!iv || (iv.application as any)?.organizationId !== orgId) {
    throw createError({ statusCode: 404, statusMessage: 'Интервью не найдено' })
  }

  // Upsert meeting_report (unique per org + externalMeetingId).
  const existing = await db.query.meetingReport.findFirst({
    where: and(eq(meetingReport.organizationId, orgId), eq(meetingReport.externalMeetingId, body.externalMeetingId)),
    columns: { id: true },
  })

  let reportId: string
  if (existing) {
    await db.update(meetingReport)
      .set({ status: 'importing', interviewId, applicationId: iv.applicationId, title: body.title ?? null, sourceUrl: body.sourceUrl ?? null, importedById: session.user.id, errorMessage: null })
      .where(eq(meetingReport.id, existing.id))
    reportId = existing.id
  }
  else {
    const [created] = await db.insert(meetingReport)
      .values({
        organizationId: orgId,
        interviewId,
        applicationId: iv.applicationId,
        status: 'importing',
        externalMeetingId: body.externalMeetingId,
        title: body.title ?? null,
        sourceUrl: body.sourceUrl ?? null,
        importedById: session.user.id,
      })
      .returning({ id: meetingReport.id })
    reportId = created!.id
  }

  await enqueueMymeetImport({ organizationId: orgId, meetingReportId: reportId, externalMeetingId: body.externalMeetingId })

  return { meetingReportId: reportId, interviewId, status: 'importing' }
})
