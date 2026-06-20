/**
 * Авто-отклонение заявок по результатам AI-скоринга.
 *
 * Единая точка входа для всех трёх триггеров:
 *   1) autoScoreOnApply (fire-and-forget при создании заявки)
 *   2) Ручная переоценка через /api/applications/[id]/analyze
 *   3) Массовая переоценка /api/jobs/[id]/batch-score
 *
 * Решение принимается на основе:
 *   - job.autoRejectEnabled       — правило включено для вакансии
 *   - job.autoRejectBelowScore    — порог; срабатывает при score < threshold (строго меньше)
 *   - composite confidence        — если < 50%, ставим application.needsManualReview = true вместо отказа
 *   - candidate.manualReviewOnly  — VIP-флаг: правило игнорируется полностью
 *   - applicationStageHistory     — если рекрутёр уже двигал заявку (movedByUserId IS NOT NULL),
 *                                    ничего не трогаем (его решение приоритетнее AI)
 *   - currentStage.isTerminal     — заявка уже в терминальном этапе (hired/rejected/...) — не трогаем
 *
 * Возвращаемое значение описывает что именно произошло (для метрик и тестов).
 *
 * Функция НЕ кидает исключений наружу: любая внутренняя ошибка логируется
 * и возвращает outcome 'error' — основной поток скоринга не должен падать.
 */

import { eq, and, isNotNull } from 'drizzle-orm'
import {
  application, applicationStageHistory, candidate, job,
  pipelineStage, criterionScore, scoringCriterion,
} from '../../database/schema'
import { computeCompositeConfidence } from './scoring'
import type { CriterionDefinition, CriterionEvaluation } from './scoring'

/** Минимальная уверенность AI, ниже которой авто-отказ не применяется. */
export const MIN_CONFIDENCE_FOR_AUTO_REJECT = 50

export type AutoRejectOutcome =
  | 'rejected'                  // успешно перевели в reject-terminal
  | 'needs_manual_review'       // score < threshold, но confidence низкая → пометили needsManualReview
  | 'skip_disabled'             // job.autoRejectEnabled = false
  | 'skip_no_threshold'         // порог не задан
  | 'skip_above_threshold'      // score >= threshold
  | 'skip_no_score'             // application.score = null
  | 'skip_manual_review_only'   // candidate.manualReviewOnly = true (VIP)
  | 'skip_recruiter_touched'    // рекрутёр уже двигал заявку
  | 'skip_terminal_stage'       // заявка уже в терминальном этапе
  | 'skip_no_reject_stage'      // в пайплайне нет reject-terminal
  | 'error'                     // внутренняя ошибка

export interface AutoRejectResult {
  outcome: AutoRejectOutcome
  /** Полезные детали для логов/тестов. */
  meta?: {
    score?: number | null
    threshold?: number | null
    confidence?: number | null
    targetStageId?: string
    targetStageName?: string
  }
}

/**
 * Применить правило авто-отказа к одной заявке.
 *
 * Вызывается СРАЗУ после того, как новые scores записаны в БД.
 * Если `evaluationsHint` передан — composite confidence считается из них
 * без обращения к БД (быстрый путь). Иначе достанем criterion_score из БД.
 */
export async function applyAutoRejectIfNeeded(
  applicationId: string,
  orgId: string,
  evaluationsHint?: {
    criteria: CriterionDefinition[]
    evaluations: CriterionEvaluation[]
  },
): Promise<AutoRejectResult> {
  try {
    // 1. Загружаем заявку + кандидата + вакансию + текущий этап
    const app = await db.query.application.findFirst({
      where: and(
        eq(application.id, applicationId),
        eq(application.organizationId, orgId),
      ),
      columns: {
        id: true,
        score: true,
        jobId: true,
        candidateId: true,
        currentStageId: true,
      },
      with: {
        candidate: { columns: { id: true, manualReviewOnly: true } },
        job: {
          columns: {
            id: true,
            pipelineId: true,
            autoRejectEnabled: true,
            autoRejectBelowScore: true,
            autoRejectReasonNote: true,
          },
        },
        currentStage: { columns: { id: true, isTerminal: true, type: true } },
      },
    })

    if (!app) {
      return { outcome: 'error', meta: {} }
    }

    // ── Защита 1: правило выключено
    if (!app.job.autoRejectEnabled) {
      return { outcome: 'skip_disabled' }
    }

    // ── Защита 2: порог не задан или некорректен
    const threshold = app.job.autoRejectBelowScore
    if (threshold === null || threshold === undefined || threshold < 0 || threshold > 100) {
      return { outcome: 'skip_no_threshold', meta: { threshold } }
    }

    // ── Защита 3: VIP-кандидат (manualReviewOnly)
    if (app.candidate.manualReviewOnly) {
      return { outcome: 'skip_manual_review_only', meta: { score: app.score, threshold } }
    }

    // ── Защита 4: уже в терминальном этапе (рекрутёр или предыдущий авто-проход уже решил)
    if (app.currentStage?.isTerminal) {
      return { outcome: 'skip_terminal_stage', meta: { score: app.score, threshold } }
    }

    // ── Защита 5: рекрутёр уже двигал заявку (movedByUserId IS NOT NULL хотя бы в одной записи)
    const recruiterTouch = await db.query.applicationStageHistory.findFirst({
      where: and(
        eq(applicationStageHistory.applicationId, applicationId),
        eq(applicationStageHistory.organizationId, orgId),
        isNotNull(applicationStageHistory.movedByUserId),
      ),
      columns: { id: true },
    })
    if (recruiterTouch) {
      return { outcome: 'skip_recruiter_touched', meta: { score: app.score, threshold } }
    }

    // ── Проверка score
    if (app.score === null || app.score === undefined) {
      return { outcome: 'skip_no_score', meta: { threshold } }
    }
    if (app.score >= threshold) {
      return { outcome: 'skip_above_threshold', meta: { score: app.score, threshold } }
    }

    // ── Считаем композитную уверенность
    let confidence: number
    if (evaluationsHint) {
      confidence = computeCompositeConfidence(evaluationsHint.criteria, evaluationsHint.evaluations)
    }
    else {
      // Fallback: восстанавливаем из БД (criterion_score + scoring_criterion для весов)
      const [scores, criteria] = await Promise.all([
        db.select().from(criterionScore).where(and(
          eq(criterionScore.applicationId, applicationId),
          eq(criterionScore.organizationId, orgId),
        )),
        db.select().from(scoringCriterion).where(and(
          eq(scoringCriterion.jobId, app.jobId),
          eq(scoringCriterion.organizationId, orgId),
        )),
      ])

      const criteriaDefs: CriterionDefinition[] = criteria.map(c => ({
        key: c.key,
        name: c.name,
        description: c.description,
        category: c.category,
        maxScore: c.maxScore,
        weight: c.weight,
      }))
      const evaluationsFromDb: CriterionEvaluation[] = scores.map(s => ({
        criterionKey: s.criterionKey,
        maxScore: s.maxScore,
        applicantScore: s.applicantScore,
        confidence: s.confidence,
        evidence: s.evidence,
        strengths: (s.strengths as string[] | null) ?? [],
        gaps: (s.gaps as string[] | null) ?? [],
      }))

      confidence = computeCompositeConfidence(criteriaDefs, evaluationsFromDb)
    }

    // ── Низкая уверенность → не отклоняем, помечаем для ручной проверки
    if (confidence < MIN_CONFIDENCE_FOR_AUTO_REJECT) {
      await db.update(application)
        .set({ needsManualReview: true, updatedAt: new Date() })
        .where(and(
          eq(application.id, applicationId),
          eq(application.organizationId, orgId),
        ))
      return {
        outcome: 'needs_manual_review',
        meta: { score: app.score, threshold, confidence },
      }
    }

    // ── Уверенность достаточна → ищем reject-terminal стадию пайплайна
    if (!app.job.pipelineId) {
      return { outcome: 'skip_no_reject_stage', meta: { score: app.score, threshold, confidence } }
    }

    const rejectStage = await db.query.pipelineStage.findFirst({
      where: and(
        eq(pipelineStage.pipelineId, app.job.pipelineId),
        eq(pipelineStage.organizationId, orgId),
        eq(pipelineStage.type, 'rejected'),
        eq(pipelineStage.isTerminal, true),
        eq(pipelineStage.isArchived, false),
      ),
      columns: { id: true, name: true, color: true },
      orderBy: (stage, { asc }) => [asc(stage.displayOrder)],
    })

    if (!rejectStage) {
      return { outcome: 'skip_no_reject_stage', meta: { score: app.score, threshold, confidence } }
    }

    // ── Применяем отказ: stage update + история (movedByUserId = null = system)
    const reasonComment = buildAutoRejectComment(app.score, threshold, confidence, app.job.autoRejectReasonNote)
    const now = new Date()

    await db.transaction(async (tx) => {
      await tx.update(application)
        .set({
          currentStageId: rejectStage.id,
          stageChangedAt: now,
          status: 'rejected',
          needsManualReview: false, // сброс — теперь финальное решение
          updatedAt: now,
        })
        .where(and(
          eq(application.id, applicationId),
          eq(application.organizationId, orgId),
        ))

      await tx.insert(applicationStageHistory).values({
        organizationId: orgId,
        applicationId,
        fromStageId: app.currentStageId ?? undefined,
        toStageId: rejectStage.id,
        movedByUserId: null, // system actor
        comment: reasonComment,
      })
    })

    return {
      outcome: 'rejected',
      meta: {
        score: app.score,
        threshold,
        confidence,
        targetStageId: rejectStage.id,
        targetStageName: rejectStage.name,
      },
    }
  }
  catch (err) {
    // Не пробрасываем ошибку — авто-правило не должно ломать основной скоринг
    logWarn?.('auto_reject.failed', {
      application_id: applicationId,
      org_id: orgId,
      error_message: err instanceof Error ? err.message : String(err),
    }) ?? console.warn('[auto_reject.failed]', applicationId, err)
    return { outcome: 'error' }
  }
}

/** Формирует понятный комментарий для applicationStageHistory. */
function buildAutoRejectComment(
  score: number,
  threshold: number,
  confidence: number,
  customNote: string | null | undefined,
): string {
  const base = `Авто-отказ по AI-скору: ${score}/100 ниже порога ${threshold}/100 (уверенность ${confidence}%).`
  return customNote && customNote.trim().length > 0
    ? `${base} ${customNote.trim()}`
    : base
}
