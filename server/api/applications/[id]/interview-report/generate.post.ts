import { and, eq } from 'drizzle-orm'
import { requireApplicationInScope } from '../../../../utils/access/scope'
import { application, meetingReport } from '../../../../database/schema'
import { applicationIdParamSchema, generateInterviewReportSchema } from '../../../../utils/schemas/reportTemplate'
import { isMymeetConnected } from '../../../../utils/mymeet/account'
import { enqueueMymeetImport } from '../../../../utils/mymeet/worker'
import { enqueueInterviewReport } from '../../../../utils/mymeet/interviewReportWorker'
import { ensureDefaultReportTemplate } from '../../../../utils/questions/seedReportTemplate'
import { createRateLimiter } from '../../../../utils/rateLimit'

const limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 10, message: 'Слишком много запросов на генерацию отчёта. Повторите позже' })

/**
 * POST /api/applications/:id/interview-report/generate
 * Поток А (mymeet): импорт готового отчёта hr-interview. Поток Б (assistant):
 * генерация нашим ассистентом из транскрипта+опросника+BARS. interview:['update'].
 */
export default defineEventHandler(async (event) => {
  await limiter(event)
  const session = await requirePermission(event, { interview: ['update'] })
  const orgId = session.session.activeOrganizationId
  const { id: applicationId } = await getValidatedRouterParams(event, applicationIdParamSchema.parse)
  await requireApplicationInScope(event, applicationId as string, orgId)
  const body = await readValidatedBody(event, generateInterviewReportSchema.parse)

  const app = await db.query.application.findFirst({
    where: and(eq(application.id, applicationId), eq(application.organizationId, orgId)),
    columns: { id: true },
  })
  if (!app) throw createError({ statusCode: 404, statusMessage: 'Отклик не найден' })

  if (!(await isMymeetConnected(orgId))) {
    throw createError({ statusCode: 422, statusMessage: 'MyMeet не подключён' })
  }
  const externalMeetingId = body.externalMeetingId?.trim()
  if (!externalMeetingId) throw createError({ statusCode: 400, statusMessage: 'Не указан externalMeetingId (встреча MyMeet)' })

  const isAssistant = body.source === 'assistant'
  let reportTemplateId: string | null = null
  if (isAssistant) {
    if (body.reportTemplateId) reportTemplateId = body.reportTemplateId
    else {
      const def = await ensureDefaultReportTemplate(orgId, session.user.id)
      reportTemplateId = def.id
    }
  }

  // Upsert meeting_report (unique org+externalMeetingId).
  const [row] = await db.insert(meetingReport).values({
    organizationId: orgId,
    interviewId: body.interviewId ?? null,
    applicationId,
    externalMeetingId,
    status: isAssistant ? 'generating' : 'importing',
    source: isAssistant ? 'assistant' : 'mymeet',
    reportTemplateId,
    mymeetTemplate: isAssistant ? null : 'hr-interview',
    importedById: session.user.id,
  }).onConflictDoUpdate({
    target: [meetingReport.organizationId, meetingReport.externalMeetingId],
    set: {
      applicationId,
      interviewId: body.interviewId ?? null,
      status: isAssistant ? 'generating' : 'importing',
      source: isAssistant ? 'assistant' : 'mymeet',
      reportTemplateId,
      mymeetTemplate: isAssistant ? null : 'hr-interview',
      errorMessage: null,
    },
  }).returning()

  if (isAssistant) {
    await enqueueInterviewReport({
      organizationId: orgId,
      meetingReportId: row.id,
      applicationId,
      externalMeetingId,
      reportTemplateId,
      writeBackAnswers: body.writeBackAnswers,
      createdById: session.user.id,
    })
  }
  else {
    await enqueueMymeetImport({ organizationId: orgId, meetingReportId: row.id, externalMeetingId })
  }

  return { meetingReportId: row.id, source: body.source, status: row.status }
})
