/**
 * POST /api/hh/auto-respond/log/:id/retry
 *
 * Re-send a failed auto-respond message. Loads the original log entry,
 * its rule and negotiation, renders the template and sends again via
 * sendNegotiationMessage. Updates the log status.
 */
import { and, eq } from 'drizzle-orm'
import {
  hhAutoRespondLog,
  hhAutoRespondRule,
  hhNegotiation,
  hhVacancyLink,
  job,
  application,
  candidate,
} from '../../../../../database/schema'
import { sendNegotiationMessage } from '../../../../../utils/hh/sourcing/pushAction'
import { renderMessageTemplate } from '../../../../../utils/hh/autoRespond'

export default defineEventHandler(async (event) => {
  const { session } = await requirePermission(event, { hhAutoRespond: ['create'] })
  const orgId = session.activeOrganizationId
  const logId = getRouterParam(event, 'id')

  if (!logId) {
    throw createError({ statusCode: 400, statusMessage: 'Не указан ID записи' })
  }

  const [logEntry] = await db
    .select()
    .from(hhAutoRespondLog)
    .where(and(eq(hhAutoRespondLog.id, logId), eq(hhAutoRespondLog.organizationId, orgId)))
    .limit(1)
  if (!logEntry) {
    throw createError({ statusCode: 404, statusMessage: 'Запись не найдена' })
  }

  if (!logEntry.ruleId || !logEntry.negotiationId || !logEntry.hhAccountId) {
    throw createError({ statusCode: 400, statusMessage: 'Недостаточно данных для повторной отправки' })
  }

  const [rule] = await db
    .select()
    .from(hhAutoRespondRule)
    .where(eq(hhAutoRespondRule.id, logEntry.ruleId))
    .limit(1)
  if (!rule) {
    throw createError({ statusCode: 404, statusMessage: 'Правило не найдено' })
  }

  const [nego] = await db
    .select({
      hhNegotiationId: hhNegotiation.hhNegotiationId,
      hhVacancyLinkId: hhNegotiation.hhVacancyLinkId,
    })
    .from(hhNegotiation)
    .where(and(
      eq(hhNegotiation.organizationId, orgId),
      eq(hhNegotiation.hhNegotiationId, logEntry.negotiationId),
    ))
    .limit(1)
  if (!nego) {
    throw createError({ statusCode: 404, statusMessage: 'Переговоры не найдены' })
  }

  const [link] = await db
    .select({ jobId: hhVacancyLink.jobId })
    .from(hhVacancyLink)
    .where(eq(hhVacancyLink.id, nego.hhVacancyLinkId))
    .limit(1)

  const [jobRow] = link
    ? await db.select({ title: job.title }).from(job).where(eq(job.id, link.jobId)).limit(1)
    : [null]

  let candidateName: string | null = null
  if (logEntry.applicationId) {
    const [appRow] = await db
      .select({ candidateId: application.candidateId })
      .from(application)
      .where(eq(application.id, logEntry.applicationId))
      .limit(1)
    if (appRow) {
      const [candRow] = await db
        .select({ firstName: candidate.firstName, lastName: candidate.lastName })
        .from(candidate)
        .where(eq(candidate.id, appRow.candidateId))
        .limit(1)
      if (candRow) {
        candidateName = `${candRow.firstName} ${candRow.lastName ?? ''}`.trim()
      }
    }
  }

  const messageText = renderMessageTemplate(rule.messageTemplate, {
    candidateName,
    vacancyName: jobRow?.title ?? null,
  })

  try {
    const result = await sendNegotiationMessage({
      organizationId: orgId,
      hhAccountId: logEntry.hhAccountId,
      negotiationId: logEntry.negotiationId,
      messageText,
      userId: rule.createdByUserId ?? null,
      applicationId: logEntry.applicationId,
    })

    const status = result.sent ? 'sent' : 'skipped'
    await db.update(hhAutoRespondLog)
      .set({ status, error: null, messagePreview: messageText.slice(0, 200) })
      .where(eq(hhAutoRespondLog.id, logId))

    return { sent: result.sent }
  }
  catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    await db.update(hhAutoRespondLog)
      .set({ status: 'failed', error: errMsg.slice(0, 1000), messagePreview: messageText.slice(0, 200) })
      .where(eq(hhAutoRespondLog.id, logId))
    throw createError({ statusCode: 500, statusMessage: errMsg.slice(0, 200) })
  }
})
