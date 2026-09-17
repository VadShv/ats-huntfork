/**
 * Background import of hh.ru applicant_comments.
 * Triggered when a candidate gets hh_applicant_id (via sync or manual linking).
 * Fetches ALL pages, upserts with correct attribution (authorUserId: null).
 */
import { and, eq, desc } from 'drizzle-orm'
import { application, applicationComment, candidate } from '../../database/schema/app'
import { getBoss } from '../queue/boss'
import { resolveHhAccountForJob } from './link'
import { resolveHhConfig } from './config'
import { getValidAccessToken } from './tokens'
import { listApplicantComments, extractApplicantId } from './applicantComments'
import { renderMarkdown } from '../comments/sanitize'
import { stripHtml } from './vacancyParser'

export const HH_COMMENT_IMPORT_QUEUE = 'hh-comment-import'

export async function enqueueCommentImport(candidateId: string, orgId: string): Promise<void> {
  try {
    const boss = await getBoss()
    await boss.send(HH_COMMENT_IMPORT_QUEUE, { candidateId, orgId }, {
      retryLimit: 2,
      retryDelay: 30,
      retryBackoff: true,
      expireInSeconds: 300,
      singletonKey: `ci:${candidateId}`,
      singletonSeconds: 300,
    })
  } catch {
    // Best-effort — don't crash the caller
  }
}

export async function processCommentImportJob(job: { data: { candidateId: string, orgId: string } }): Promise<void> {
  const { candidateId, orgId } = job.data
  await importApplicantCommentsForCandidate(candidateId, orgId)
}

async function importApplicantCommentsForCandidate(candidateId: string, orgId: string): Promise<void> {
  const app = await db.query.application.findFirst({
    where: and(
      eq(application.candidateId, candidateId),
      eq(application.organizationId, orgId),
      eq(application.source, 'hh'),
    ),
    orderBy: [desc(application.createdAt)],
    columns: { id: true, jobId: true },
  })
  if (!app) return

  const cand = await db.query.candidate.findFirst({
    where: eq(candidate.id, candidateId),
    columns: { hhApplicantId: true, hhResumeRaw: true },
  })
  const applicantId = cand?.hhApplicantId ?? extractApplicantId(cand?.hhResumeRaw)
  if (!applicantId) return

  if (cand?.hhApplicantId !== applicantId) {
    await db.update(candidate).set({ hhApplicantId: applicantId }).where(eq(candidate.id, candidateId))
  }

  const hhAccountId = await resolveHhAccountForJob(orgId, app.jobId)
  let token: string
  try {
    token = await getValidAccessToken(hhAccountId)
  } catch {
    return
  }
  const config = await resolveHhConfig(orgId)

  let page = 0
  let totalPages = 1
  while (page < totalPages) {
    let data
    try {
      data = await listApplicantComments(applicantId, token, config, page)
    } catch (err) {
      const e = err as Error & { status?: number }
      if (e.status === 403) return
      throw err
    }
    totalPages = data.pages || 1

    for (const c of data.items ?? []) {
      if (!c.id) continue
      const plainBody = stripHtml(c.text ?? '')
      if (!plainBody) continue

      const now = new Date(c.created_at ?? Date.now())
      try {
        await db.insert(applicationComment).values({
          organizationId: orgId,
          applicationId: app.id,
          candidateId,
          authorUserId: null,
          body: plainBody,
          bodyHtml: renderMarkdown(plainBody),
          isInternal: false,
          hhCommentId: c.id,
          hhApplicantId: applicantId,
          hhAuthorName: c.author?.full_name ?? null,
          hhDirection: 'incoming',
          hhSyncStatus: 'synced',
          hhSyncedAt: now,
          createdAt: now,
        }).onConflictDoNothing()
      } catch {
        // skip individual insert errors
      }
    }
    page++
  }
}
