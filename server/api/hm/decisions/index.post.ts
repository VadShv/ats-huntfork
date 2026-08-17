import { and, eq } from 'drizzle-orm'
import { application, pipelineStage } from '../../../database/schema/app'
import { hmDecision } from '../../../database/schema/hm'
import { createHmDecisionSchema } from '../../../utils/schemas/hiringManager'
import { requireHm } from '../../../utils/requireHm'
import { isHiringManagerOnJob } from '../../../utils/hiringManager'
import { moveApplicationStage } from '../../../utils/pipeline-move'
import { resolveApprovedTargetStage, resolveRejectedTargetStage } from '../../../utils/hm-stage-resolver'

/**
 * POST /api/hm/decisions
 * НМ выносит решение (одобрено/отклонено) по кандидату на этапе `new`.
 *
 * Модель first-decision-wins:
 *   - Partial unique index ux_hm_decisions_effective_per_app гарантирует,
 *     что второй НМ, отправивший решение параллельно, получит 409.
 *   - Второй НМ увидит на клиенте: «Кандидат уже {approved|rejected} НМ X».
 *
 * Побочный эффект: переход этапа заявки в системном контексте (actorUserId=null),
 * с меткой activityAction='hm_approved' / 'hm_rejected' для аудита.
 *
 * hh.ru push НЕ выполняем — решение НМ внутреннее событие HuntFork.
 */
export default defineEventHandler(async (event) => {
  const session = await requireHm(event)
  const orgId = session.session.activeOrganizationId
  const hmUserId = session.user.id

  const body = await readValidatedBody(event, createHmDecisionSchema.parse)

  // ── 1. Заявка → jobId + проверка что она в стадии `new` ─────
  const [app] = await db
    .select({
      id: application.id,
      jobId: application.jobId,
      currentStageId: application.currentStageId,
    })
    .from(application)
    .where(and(
      eq(application.id, body.applicationId),
      eq(application.organizationId, orgId),
    ))
    .limit(1)
  if (!app) {
    throw createError({ statusCode: 404, statusMessage: 'Отклик не найден' })
  }

  // Проверяем что кандидат на канонической стадии `new` (или её legacy-алиасе `applied`)
  if (app.currentStageId) {
    const [stage] = await db
      .select({ type: pipelineStage.type })
      .from(pipelineStage)
      .where(eq(pipelineStage.id, app.currentStageId))
      .limit(1)
    if (!stage || (stage.type !== 'new' && stage.type !== 'applied')) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Решение НМ доступно только для кандидатов в «Неразобранных»',
      })
    }
  }

  // ── 2. НМ назначен на эту вакансию ──────────────────────────
  const isAssigned = await isHiringManagerOnJob(orgId, hmUserId, app.jobId)
  if (!isAssigned) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Вы не назначены Нанимающим менеджером на эту вакансию',
    })
  }

  // ── 3. Идемпотентность / self-repair.
  //   Если уже есть эффективное решение — не пытаемся вставлять второе.
  //   • Тот же НМ + тоже решение → возвращаем success + при необходимости
  //     дозапускаем move stage (авто-починка, если раньше упало между
  //     insert и stage move).
  //   • Иначе → 409 с текстом «другой НМ уже вынес решение».
  const [existingEffective] = await db
    .select({
      id: hmDecision.id,
      decision: hmDecision.decision,
      hmUserId: hmDecision.hmUserId,
      decidedAt: hmDecision.decidedAt,
    })
    .from(hmDecision)
    .where(and(
      eq(hmDecision.applicationId, app.id),
      eq(hmDecision.isEffective, true),
    ))
    .limit(1)

  if (existingEffective) {
    const sameHm = existingEffective.hmUserId === hmUserId
    const sameDecision = existingEffective.decision === body.decision
    if (!(sameHm && sameDecision)) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Другой НМ уже вынес решение по этому кандидату',
        data: {
          conflict: 'first_decision_wins',
          existingDecision: existingEffective.decision,
          existingHmUserId: existingEffective.hmUserId,
          decidedAt: existingEffective.decidedAt,
        },
      })
    }
    // Тот же НМ повторил то же решение — досдвигаем stage если ещё не на терминале.
    const targetStageForRepair = body.decision === 'approved'
      ? await resolveApprovedTargetStage({ organizationId: orgId, applicationId: app.id })
      : await resolveRejectedTargetStage({ organizationId: orgId, jobId: app.jobId })

    let repairMove: Awaited<ReturnType<typeof moveApplicationStage>> | null = null
    if (app.currentStageId !== targetStageForRepair.stageId) {
      repairMove = await moveApplicationStage({
        organizationId: orgId,
        applicationId: app.id,
        toStageId: targetStageForRepair.stageId,
        actorUserId: null,
        comment: body.comment,
        activityAction: body.decision === 'approved' ? 'hm_approved' : 'hm_rejected',
        activityMetadataExtras: {
          hmDecisionId: existingEffective.id,
          hmUserId,
          repaired: true,
        },
      })
    }
    return {
      success: true,
      repaired: repairMove !== null,
      decision: {
        id: existingEffective.id,
        applicationId: app.id,
        decision: existingEffective.decision,
        targetStage: targetStageForRepair.stageName,
      },
      stage: repairMove
        ? { fromStageName: repairMove.fromStageName, toStageName: repairMove.toStageName }
        : null,
    }
  }

  // ── 4. Резолвим целевой этап ───────────────────────────────
  const targetStage = body.decision === 'approved'
    ? await resolveApprovedTargetStage({ organizationId: orgId, applicationId: app.id })
    : await resolveRejectedTargetStage({ organizationId: orgId, jobId: app.jobId })

  // ── 5. Вставляем hm_decision, затем двигаем stage.
  //   При ошибке stage-move выполняем compensating delete hm_decision,
  //   иначе получим «эффективное» решение без движения по воронке
  //   — то блокирующее состояние, что мы видели на проде.
  //   Partial unique index бросит 23505 при гонке с другим НМ.
  let decisionId: string
  let moveResult: Awaited<ReturnType<typeof moveApplicationStage>>
  try {
    const [row] = await db.insert(hmDecision).values({
      organizationId: orgId,
      applicationId: app.id,
      jobId: app.jobId,
      hmUserId,
      decision: body.decision,
      comment: body.comment,
      isEffective: true,
    }).returning({ id: hmDecision.id })
    decisionId = row.id

    try {
      moveResult = await moveApplicationStage({
        organizationId: orgId,
        applicationId: app.id,
        toStageId: targetStage.stageId,
        actorUserId: null,
        comment: body.comment,
        activityAction: body.decision === 'approved' ? 'hm_approved' : 'hm_rejected',
        activityMetadataExtras: {
          hmDecisionId: decisionId,
          hmUserId,
        },
      })
    }
    catch (moveErr) {
      // compensating: убираем созданное решение чтобы не блокировать повтор.
      await db.delete(hmDecision).where(eq(hmDecision.id, decisionId)).catch(() => {})
      throw moveErr
    }
  }
  catch (err: any) {
    // Postgres unique_violation → гонка с другим НМ
    if (err?.code === '23505' || /ux_hm_decisions_effective_per_app|unique/i.test(err?.message ?? '')) {
      const [existing] = await db
        .select({
          id: hmDecision.id,
          decision: hmDecision.decision,
          hmUserId: hmDecision.hmUserId,
          decidedAt: hmDecision.decidedAt,
        })
        .from(hmDecision)
        .where(and(
          eq(hmDecision.applicationId, app.id),
          eq(hmDecision.isEffective, true),
        ))
        .limit(1)
      throw createError({
        statusCode: 409,
        statusMessage: 'Другой НМ уже вынес решение по этому кандидату',
        data: existing ? {
          conflict: 'first_decision_wins',
          existingDecision: existing.decision,
          existingHmUserId: existing.hmUserId,
          decidedAt: existing.decidedAt,
        } : { conflict: 'first_decision_wins' },
      })
    }
    throw err
  }

  // ── 6. Отдельная запись о решении НМ в аудит (actor = НМ) ───
  void recordActivity({
    organizationId: orgId,
    actorId: hmUserId,
    action: body.decision === 'approved' ? 'hm_approved' : 'hm_rejected',
    resourceType: 'hm_decision',
    resourceId: decisionId,
    metadata: {
      applicationId: app.id,
      jobId: app.jobId,
      targetStage: targetStage.stageName,
      ...(body.comment ? { comment: body.comment } : {}),
    },
  })

  return {
    success: true,
    decision: {
      id: decisionId,
      applicationId: app.id,
      decision: body.decision,
      targetStage: targetStage.stageName,
    },
    stage: {
      fromStageName: moveResult.fromStageName,
      toStageName: moveResult.toStageName,
    },
  }
})
