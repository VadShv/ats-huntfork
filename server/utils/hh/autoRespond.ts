/**
 * Auto-respond engine for hh.ru integration.
 *
 * When a new negotiation is imported from hh.ru (via sync.ts), this module
 * evaluates active auto-respond rules and sends a message to the candidate
 * if a rule matches. Reuses sendNegotiationMessage from pushAction.ts.
 */
import { and, eq, asc } from 'drizzle-orm'
import {
  hhAutoRespondRule,
  hhNegotiation,
  hhVacancyLink,
  job,
  candidate,
  application,
} from '../../database/schema'
import { sendNegotiationMessage } from './sourcing/pushAction'

/**
 * Replace template variables in the message text.
 * Supported: {{candidateName}}, {{vacancyName}}, {{recruiterName}}
 */
export function renderMessageTemplate(
  template: string,
  vars: {
    candidateName?: string | null
    vacancyName?: string | null
    recruiterName?: string | null
  },
): string {
  return template
    .replace(/\{\{candidateName\}\}/g, vars.candidateName ?? 'Кандидат')
    .replace(/\{\{vacancyName\}\}/g, vars.vacancyName ?? 'вакансия')
    .replace(/\{\{recruiterName\}\}/g, vars.recruiterName ?? 'рекрутер')
}

/**
 * Evaluate auto-respond rules for a newly imported application.
 * Called from sync.ts after application creation (fire-and-forget).
 *
 * Finds the hhNegotiation for this application, loads active rules,
 * matches by collection, renders the message template, and sends
 * via hh.ru API using the existing sendNegotiationMessage.
 */
export async function evaluateAutoRespond(args: {
  orgId: string
  applicationId: string
  hhAccountId: string
}): Promise<{ triggered: boolean, ruleId?: string, error?: string }> {
  // 1. Find the hh_negotiation for this application
  const [nego] = await db
    .select({
      hhNegotiationId: hhNegotiation.hhNegotiationId,
      hhCollection: hhNegotiation.hhCollection,
      hhVacancyLinkId: hhNegotiation.hhVacancyLinkId,
    })
    .from(hhNegotiation)
    .where(and(
      eq(hhNegotiation.organizationId, args.orgId),
      eq(hhNegotiation.applicationId, args.applicationId),
    ))
    .limit(1)

  if (!nego || !nego.hhCollection) {
    return { triggered: false }
  }

  // 2. Load active rules sorted by priority (lower = higher priority)
  const rules = await db
    .select()
    .from(hhAutoRespondRule)
    .where(and(
      eq(hhAutoRespondRule.organizationId, args.orgId),
      eq(hhAutoRespondRule.isActive, true),
    ))
    .orderBy(asc(hhAutoRespondRule.priority))

  // 3. Find first matching rule by trigger collection
  const matchingRule = rules.find(r => r.triggerCollection === nego.hhCollection)
  if (!matchingRule) {
    return { triggered: false }
  }

  // 4. Gather template variables: vacancy name + candidate name
  const [link] = await db
    .select({ jobId: hhVacancyLink.jobId })
    .from(hhVacancyLink)
    .where(eq(hhVacancyLink.id, nego.hhVacancyLinkId))
    .limit(1)

  const [jobRow] = link
    ? await db.select({ title: job.title }).from(job).where(eq(job.id, link.jobId)).limit(1)
    : [null]

  // Get candidate name via application → candidate
  const [appRow] = await db
    .select({ candidateId: application.candidateId })
    .from(application)
    .where(eq(application.id, args.applicationId))
    .limit(1)

  let candidateName: string | null = null
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

  // 5. Render message
  const messageText = renderMessageTemplate(matchingRule.messageTemplate, {
    candidateName,
    vacancyName: jobRow?.title ?? null,
  })

  // 6. Send via hh.ru API (reuses existing sendNegotiationMessage with dedup)
  try {
    const result = await sendNegotiationMessage({
      organizationId: args.orgId,
      hhAccountId: args.hhAccountId,
      negotiationId: nego.hhNegotiationId,
      messageText,
      userId: matchingRule.createdByUserId ?? null,
      applicationId: args.applicationId,
    })

    if (!result.sent) {
      // Duplicate (already sent within 60s) — not an error
      return { triggered: false }
    }

    return { triggered: true, ruleId: matchingRule.id }
  }
  catch (err) {
    return {
      triggered: false,
      ruleId: matchingRule.id,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
