/**
 * «Передать коллеге» — связка реферала с откликами, обсуждением и уведомлениями
 * (docs/tz-discussion-referral.md §2–3).
 *
 *  - placeCandidateOnJob      — положить кандидата на вакансию (переиспользовать отклик или создать).
 *  - createReferralCard       — системная карточка `system_event/referral` в ленте отклика.
 *  - updateReferralCardStatus — обновить статус в уже созданной карточке (без новой записи).
 *  - notifyReferral           — уведомление адресату (type 'referral').
 *
 * Карточки — внутренние (is_internal = true): к кандидату и заказчику не уходят.
 */
import { and, eq } from 'drizzle-orm'
import { application, applicationComment, applicationStageHistory, job } from '../../database/schema/app'
import { notification } from '../../database/schema/app'
import { user } from '../../database/schema/auth'
import { getEntryStageForPipeline } from '../pipeline-helpers'
import { escapeHtml } from '../comments/sanitize'
import { notifyThreadChanged } from '../comments/threadBus'
import { buildReferralBody, type ReferralEventPayload, type ReferralStatus } from '../../../shared/referrals/event'

type Db = typeof db

export async function placeCandidateOnJob(
  database: Db,
  params: { orgId: string, candidateId: string, jobId: string, userId: string },
): Promise<{ applicationId: string, created: boolean }> {
  const { orgId, candidateId, jobId, userId } = params
  const targetJob = await database.query.job.findFirst({
    where: and(eq(job.id, jobId), eq(job.organizationId, orgId)),
    columns: { id: true, pipelineId: true },
  })
  if (!targetJob) throw createError({ statusCode: 404, statusMessage: 'Вакансия не найдена' })

  const existing = await database.query.application.findFirst({
    where: and(eq(application.organizationId, orgId), eq(application.candidateId, candidateId), eq(application.jobId, jobId)),
    columns: { id: true },
  })
  if (existing) return { applicationId: existing.id, created: false }

  let entryStageId: string | null = null
  if (targetJob.pipelineId) {
    const entry = await getEntryStageForPipeline(database, targetJob.pipelineId)
    entryStageId = entry?.id ?? null
  }
  const now = new Date()
  const [created] = await database.insert(application).values({
    organizationId: orgId,
    candidateId,
    jobId,
    status: 'new',
    source: 'referral',
    currentStageId: entryStageId,
    stageChangedAt: entryStageId ? now : null,
  }).returning({ id: application.id })
  if (entryStageId) {
    await database.insert(applicationStageHistory).values({
      organizationId: orgId, applicationId: created!.id, fromStageId: null, toStageId: entryStageId, movedByUserId: userId, movedAt: now,
    })
  }
  return { applicationId: created!.id, created: true }
}

export async function userDisplayName(database: Db, userId: string): Promise<string> {
  const row = await database.query.user.findFirst({ where: eq(user.id, userId), columns: { name: true, email: true } })
  return row?.name || row?.email || '—'
}

export async function jobTitleOf(database: Db, orgId: string, jobId: string | null): Promise<string | null> {
  if (!jobId) return null
  const row = await database.query.job.findFirst({ where: and(eq(job.id, jobId), eq(job.organizationId, orgId)), columns: { title: true } })
  return row?.title ?? null
}

/** Создать системную карточку реферала в ленте отклика. Возвращает id комментария. */
export async function createReferralCard(
  database: Db,
  params: { orgId: string, applicationId: string, candidateId: string, authorUserId: string, payload: ReferralEventPayload },
): Promise<string> {
  const body = buildReferralBody(params.payload)
  const [row] = await database.insert(applicationComment).values({
    organizationId: params.orgId,
    applicationId: params.applicationId,
    candidateId: params.candidateId,
    authorUserId: params.authorUserId,
    body,
    bodyHtml: `<p>${escapeHtml(body)}</p>`,
    isInternal: true,
    kind: 'system_event',
    payloadJson: params.payload as unknown as Record<string, unknown>,
  }).returning({ id: applicationComment.id })
  notifyThreadChanged(params.applicationId)
  return row!.id
}

/** Обновить статус (и, при необходимости, целевой отклик) в существующей карточке. */
export async function updateReferralCardStatus(
  database: Db,
  commentId: string | null | undefined,
  patch: { status: ReferralStatus, targetApplicationId?: string | null, resolvedAt?: Date },
): Promise<void> {
  if (!commentId) return
  const row = await database.query.applicationComment.findFirst({
    where: eq(applicationComment.id, commentId),
    columns: { id: true, applicationId: true, payloadJson: true },
  })
  if (!row) return
  const payload = { ...(row.payloadJson as unknown as ReferralEventPayload), ...patch, resolvedAt: (patch.resolvedAt ?? new Date()).toISOString() }
  if (patch.targetApplicationId !== undefined) payload.targetApplicationId = patch.targetApplicationId
  const body = buildReferralBody(payload)
  await database.update(applicationComment)
    .set({ payloadJson: payload as unknown as Record<string, unknown>, body, bodyHtml: `<p>${escapeHtml(body)}</p>`, updatedAt: new Date() })
    .where(eq(applicationComment.id, commentId))
  notifyThreadChanged(row.applicationId)
}

/** Уведомление адресату: «вам передали кандидата». entityType 'referral', entityId = referral.id. */
export async function notifyReferral(
  database: Db,
  params: { orgId: string, toUserId: string, fromUserId: string, referralId: string, commentId?: string | null },
): Promise<void> {
  if (params.toUserId === params.fromUserId) return
  await database.insert(notification).values({
    organizationId: params.orgId,
    userId: params.toUserId,
    type: 'referral',
    entityType: 'referral',
    entityId: params.referralId,
    commentId: params.commentId ?? null,
    actorUserId: params.fromUserId,
  })
}
