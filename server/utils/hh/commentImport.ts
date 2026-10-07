/**
 * Фоновый импорт комментариев hh.ru (applicant_comments) в обсуждение отклика.
 *
 * Запускается при ЛЮБОМ способе появления hh-резюме у кандидата
 * (docs/discussion-module-redesign.md §5.6, решение №4):
 *   - синхронизация откликов (server/utils/hh/sync.ts);
 *   - импорт из сорсинга (server/api/sourcing-candidates/[id]/import.post.ts);
 *   - импорт резюме расширением / по ссылке (server/utils/hh/importResume.ts).
 *
 * Что делает: тянет все страницы applicant_comments, upsert по hh_comment_id
 * (authorUserId: null, hhAuthorName/дата с hh — то, что видит рекрутёр в ленте).
 * Комментарии hh — внутренняя информация рекрутёров: пишутся с is_internal = true,
 * чтобы заказчик (hiring_manager) их не видел.
 */
import { and, desc, eq, inArray } from 'drizzle-orm'
import { application, applicationComment, candidate, hhAccount } from '../../database/schema/app'
import { getBoss } from '../queue/boss'
import { resolveHhAccountForJob } from './link'
import { resolveHhConfig } from './config'
import { getValidAccessToken } from './tokens'
import { listApplicantComments, extractApplicantId } from './applicantComments'
import { renderMarkdown } from '../comments/sanitize'
import { stripHtml } from './vacancyParser'
import { notifyThreadChanged } from '../comments/threadBus'

export const HH_COMMENT_IMPORT_QUEUE = 'hh-comment-import'

/** Комментарии hh.ru — внутренняя информация команды подбора (решение №4). */
export const HH_IMPORTED_COMMENT_IS_INTERNAL = true

export interface CommentImportJobData {
  candidateId: string
  orgId: string
  /** Отклик, в обсуждение которого класть комментарии. Если не задан — последний отклик кандидата с hh-источником. */
  applicationId?: string
  /** hh-аккаунт для запроса. Если не задан — по связке вакансии, иначе первый аккаунт организации. */
  hhAccountId?: string
}

export async function enqueueCommentImport(
  candidateId: string,
  orgId: string,
  opts: { applicationId?: string, hhAccountId?: string } = {},
): Promise<void> {
  try {
    const boss = await getBoss()
    const data: CommentImportJobData = { candidateId, orgId, ...opts }
    await boss.send(HH_COMMENT_IMPORT_QUEUE, data, {
      retryLimit: 2,
      retryDelay: 30,
      retryBackoff: true,
      expireInSeconds: 300,
      // Один импорт на (кандидат, отклик) в 5 минут — повторные триггеры схлопываются.
      singletonKey: `ci:${candidateId}:${opts.applicationId ?? '-'}`,
      singletonSeconds: 300,
    })
  } catch {
    // Best-effort — не роняем вызывающий код
  }
}

export async function processCommentImportJob(job: { data: CommentImportJobData }): Promise<void> {
  await importApplicantCommentsForCandidate(job.data)
}

/** Источники откликов, у которых резюме пришло с hh.ru. */
const HH_APPLICATION_SOURCES = ['hh', 'hh_sourcing', 'hh-extension', 'extension-capture']

async function resolveTargetApplication(data: CommentImportJobData): Promise<{ id: string, jobId: string } | null> {
  if (data.applicationId) {
    const app = await db.query.application.findFirst({
      where: and(
        eq(application.id, data.applicationId),
        eq(application.organizationId, data.orgId),
        eq(application.candidateId, data.candidateId),
      ),
      columns: { id: true, jobId: true },
    })
    if (app) return app
  }
  const byHhSource = await db.query.application.findFirst({
    where: and(
      eq(application.candidateId, data.candidateId),
      eq(application.organizationId, data.orgId),
      inArray(application.source, HH_APPLICATION_SOURCES),
    ),
    orderBy: [desc(application.createdAt)],
    columns: { id: true, jobId: true },
  })
  if (byHhSource) return byHhSource
  // Резюме с hh, но отклик создан иначе (ручной перенос и т.п.) — берём последний отклик.
  return (await db.query.application.findFirst({
    where: and(eq(application.candidateId, data.candidateId), eq(application.organizationId, data.orgId)),
    orderBy: [desc(application.createdAt)],
    columns: { id: true, jobId: true },
  })) ?? null
}

async function resolveAccessToken(data: CommentImportJobData, jobId: string): Promise<string | null> {
  const candidates: string[] = []
  if (data.hhAccountId) candidates.push(data.hhAccountId)
  try {
    candidates.push(await resolveHhAccountForJob(data.orgId, jobId))
  } catch {
    // у вакансии нет связки с hh — попробуем аккаунт организации
  }
  const orgAccounts = await db
    .select({ id: hhAccount.id })
    .from(hhAccount)
    .where(eq(hhAccount.organizationId, data.orgId))
    .limit(3)
  for (const a of orgAccounts) candidates.push(a.id)

  for (const accountId of [...new Set(candidates)]) {
    try {
      return await getValidAccessToken(accountId)
    } catch {
      // следующий аккаунт
    }
  }
  return null
}

async function importApplicantCommentsForCandidate(data: CommentImportJobData): Promise<void> {
  const { candidateId, orgId } = data
  const app = await resolveTargetApplication(data)
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

  const token = await resolveAccessToken(data, app.jobId)
  if (!token) return
  const config = await resolveHhConfig(orgId)

  let inserted = 0
  let page = 0
  let totalPages = 1
  while (page < totalPages) {
    let pageData
    try {
      pageData = await listApplicantComments(applicantId, token, config, page)
    } catch (err) {
      const e = err as Error & { status?: number }
      if (e.status === 403) break
      throw err
    }
    totalPages = pageData.pages || 1

    for (const c of pageData.items ?? []) {
      if (!c.id) continue
      const plainBody = stripHtml(c.text ?? '')
      if (!plainBody) continue

      const createdOnHh = new Date(c.created_at ?? Date.now())
      try {
        const rows = await db.insert(applicationComment).values({
          organizationId: orgId,
          applicationId: app.id,
          candidateId,
          authorUserId: null,
          body: plainBody,
          bodyHtml: renderMarkdown(plainBody),
          isInternal: HH_IMPORTED_COMMENT_IS_INTERNAL,
          hhCommentId: c.id,
          hhApplicantId: applicantId,
          hhAuthorName: c.author?.full_name ?? null,
          hhDirection: 'incoming',
          hhSyncStatus: 'synced',
          hhSyncedAt: createdOnHh,
        }).onConflictDoNothing().returning({ id: applicationComment.id })
        inserted += rows.length
      } catch {
        // пропускаем единичные ошибки вставки
      }
    }
    page++
  }

  // Открытый тред узнаёт о новых сообщениях сразу (SSE).
  if (inserted > 0) notifyThreadChanged(app.id)
}
