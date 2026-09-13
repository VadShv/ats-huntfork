import { and, desc, eq } from 'drizzle-orm'
import { requireApplicationInScope } from '../../../../utils/access/scope'
import { z } from 'zod'
import {
  application,
  applicationComment,
  applicationWatcher,
  analysisRun,
  criterionScore,
  scoringCriterion,
  candidateResumeVersion,
  resumeRisk,
} from '../../../../database/schema/app'
import { user } from '../../../../database/schema/auth'
import { applicationIdParamSchema } from '../../../../utils/schemas/application'
import { ensureWatcher } from '../../../../utils/comments/ensure-watcher'
import { createNotificationsBulk } from '../../../../utils/comments/notifications'
import { notifyThreadChanged } from '../../../../utils/comments/threadBus'

/**
 * POST /api/applications/:id/comments/snapshot
 *
 * Collaboration Hub (Этап 3) — «прикрепить результат ИИ» в ленту обсуждения.
 * Снимок данных СОБИРАЕТСЯ НА СЕРВЕРЕ (не принимаем payload от клиента) — это
 * гарантирует достоверность и фиксирует обсуждаемую версию для аудита.
 *
 *   kind='ai_screening_snapshot' → балл + топ-критерии отклика (per-application)
 *   kind='risk_snapshot'         → уровень/summary/находки текущего резюме (per-candidate)
 *
 * Создаётся системный комментарий (author = текущий пользователь), уведомляются
 * watchers. is_internal=false (снимок виден всем, кто видит тред).
 */

const bodySchema = z.object({
  kind: z.enum(['ai_screening_snapshot', 'risk_snapshot']),
})

export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { application: ['update'] })
  const orgId = session.session.activeOrganizationId
  const userId = session.user.id

  const { id } = await getValidatedRouterParams(event, applicationIdParamSchema.parse)
  await requireApplicationInScope(event, id as string, orgId)
  const { kind } = await readValidatedBody(event, bodySchema.parse)

  // ── Verify application ──
  const app = await db.query.application.findFirst({
    where: and(eq(application.id, id), eq(application.organizationId, orgId)),
    columns: { id: true, candidateId: true, jobId: true },
  })
  if (!app) throw createError({ statusCode: 404, statusMessage: 'Отклик не найден' })

  let payload: Record<string, unknown>
  let fallbackBody: string

  if (kind === 'ai_screening_snapshot') {
    // Последний прогон анализа + разбивка по критериям
    const [latestRun] = await db
      .select({
        compositeScore: analysisRun.compositeScore,
        model: analysisRun.model,
        createdAt: analysisRun.createdAt,
        status: analysisRun.status,
      })
      .from(analysisRun)
      .where(and(eq(analysisRun.applicationId, id), eq(analysisRun.organizationId, orgId)))
      .orderBy(desc(analysisRun.createdAt))
      .limit(1)

    if (!latestRun || latestRun.compositeScore == null) {
      throw createError({ statusCode: 400, statusMessage: 'Скрининг ещё не запускался' })
    }

    const rows = await db
      .select({
        criterionKey: criterionScore.criterionKey,
        score: criterionScore.applicantScore,
        maxScore: criterionScore.maxScore,
        criterionName: scoringCriterion.name,
      })
      .from(criterionScore)
      .leftJoin(scoringCriterion, and(
        eq(scoringCriterion.jobId, app.jobId),
        eq(scoringCriterion.key, criterionScore.criterionKey),
      ))
      .where(and(eq(criterionScore.applicationId, id), eq(criterionScore.organizationId, orgId)))

    const criteria = rows.map(r => ({
      name: r.criterionName || r.criterionKey,
      score: r.score,
      maxScore: r.maxScore,
    }))

    payload = {
      compositeScore: latestRun.compositeScore,
      model: latestRun.model,
      assessedAt: latestRun.createdAt,
      criteria,
    }
    fallbackBody = `AI-скрининг: ${latestRun.compositeScore}/100`
  } else {
    // risk_snapshot — текущая версия резюме кандидата
    const current = await db.query.candidateResumeVersion.findFirst({
      where: and(
        eq(candidateResumeVersion.candidateId, app.candidateId),
        eq(candidateResumeVersion.isCurrent, true),
      ),
      columns: { id: true, contentHash: true },
    })
    const version = current ?? await db.query.candidateResumeVersion.findFirst({
      where: eq(candidateResumeVersion.candidateId, app.candidateId),
      orderBy: [desc(candidateResumeVersion.versionNumber)],
      columns: { id: true, contentHash: true },
    })
    if (!version) {
      throw createError({ statusCode: 400, statusMessage: 'У кандидата нет резюме для оценки' })
    }

    const risk = await db.query.resumeRisk.findFirst({
      where: and(eq(resumeRisk.resumeVersionId, version.id), eq(resumeRisk.organizationId, orgId)),
    })
    if (!risk || risk.status !== 'completed') {
      throw createError({ statusCode: 400, statusMessage: 'Риск ещё не оценивался' })
    }

    const findings = (risk.findingsJson as { findings?: unknown[] } | null)?.findings ?? []
    payload = {
      overallRisk: risk.overallRisk,
      overallScore: risk.overallScore,
      summary: risk.summary,
      findingsCount: Array.isArray(findings) ? findings.length : 0,
      stale: Boolean(risk.contentHash && risk.contentHash !== version.contentHash),
      assessedAt: risk.assessedAt ?? risk.createdAt,
    }
    fallbackBody = `Оценка рисков: ${risk.overallRisk}`
  }

  // ── INSERT system snapshot comment ──
  const [created] = await db
    .insert(applicationComment)
    .values({
      organizationId: orgId,
      applicationId: id,
      candidateId: app.candidateId,
      authorUserId: userId,
      body: fallbackBody,
      bodyHtml: null,
      isInternal: false,
      kind,
      payloadJson: payload,
    })
    .returning({
      id: applicationComment.id,
      body: applicationComment.body,
      bodyHtml: applicationComment.bodyHtml,
      isInternal: applicationComment.isInternal,
      kind: applicationComment.kind,
      payloadJson: applicationComment.payloadJson,
      parentCommentId: applicationComment.parentCommentId,
      createdAt: applicationComment.createdAt,
      updatedAt: applicationComment.updatedAt,
    })

  if (!created) {
    throw createError({ statusCode: 500, statusMessage: 'Не удалось прикрепить результат' })
  }

  // Автор — watcher; уведомляем остальных
  await ensureWatcher(db, { organizationId: orgId, applicationId: id, userId, source: 'auto_author' })
  const watchers = await db
    .select({ userId: applicationWatcher.userId })
    .from(applicationWatcher)
    .where(eq(applicationWatcher.applicationId, id))
  const targets = watchers.map(w => w.userId).filter(uid => uid !== userId)
  if (targets.length > 0) {
    await createNotificationsBulk(
      db,
      targets.map(uid => ({
        organizationId: orgId,
        userId: uid,
        type: 'new_comment_on_watched' as const,
        entityType: 'comment' as const,
        entityId: created.id,
        commentId: created.id,
        actorUserId: userId,
      })),
    )
  }

  void recordActivity({
    organizationId: orgId,
    actorId: userId,
    action: 'comment_added',
    resourceType: 'application',
    resourceId: id,
    metadata: { commentId: created.id, kind },
  })

  notifyThreadChanged(id)

  const author = await db.query.user.findFirst({
    where: eq(user.id, userId),
    columns: { id: true, name: true, email: true, image: true },
  })

  setResponseStatus(event, 201)
  return { ...created, author, mentions: [], reactions: [], attachments: [] }
})
