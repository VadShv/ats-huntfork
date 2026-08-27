/**
 * Авто-передвижение заявок на подэтап «На рассмотрении» (hm_review)
 * по результатам AI-скоринга.
 *
 * Единая точка входа для тех же трёх триггеров, что и autoReject:
 *   1) autoScoreOnApply (fire-and-forget при создании заявки)
 *   2) Ручная переоценка через /api/applications/[id]/analyze
 *   3) Массовая переоценка /api/jobs/[id]/batch-score
 *
 * Правило симметрично автоотклонению, но со знаком «>=»:
 *   - job.autoAdvanceEnabled       — правило включено
 *   - job.autoAdvanceAboveScore    — порог; срабатывает при score >= threshold
 *   - composite confidence         — если < 50%, ничего не делаем (кандидата
 *                                     двигать «наверх» с низкой уверенностью
 *                                     хуже, чем оставить в корне)
 *   - candidate.manualReviewOnly   — VIP-флаг: правило игнорируется
 *   - applicationStageHistory      — если рекрутер уже двигал заявку, ничего
 *                                     не трогаем
 *   - currentStage                 — двигаем ТОЛЬКО из корня «Все неразобранные»
 *                                     (тип new, БЕЗ parent). Если кандидат уже
 *                                     в подэтапе hm_review — тоже skip.
 *
 * Функция НЕ кидает исключений наружу.
 */
import { eq, and, isNotNull } from 'drizzle-orm'
import {
  application, applicationStageHistory, criterionScore, scoringCriterion,
} from '../../database/schema'
import { moveApplicationStage } from '../pipeline-move'
import { resolveHmReviewStage } from '../hm-stage-resolver'
import { computeCompositeConfidence } from './scoring'
import type { CriterionDefinition, CriterionEvaluation } from './scoring'

/** Минимальная уверенность AI, ниже которой авто-передвижение не применяется. */
export const MIN_CONFIDENCE_FOR_AUTO_ADVANCE = 50

export type AutoAdvanceOutcome =
  | 'advanced'                  // успешно перевели на hm_review
  | 'skip_disabled'             // job.autoAdvanceEnabled = false
  | 'skip_no_threshold'         // порог не задан
  | 'skip_below_threshold'      // score < threshold
  | 'skip_no_score'             // application.score = null
  | 'skip_low_confidence'       // composite confidence < 50%
  | 'skip_manual_review_only'   // candidate.manualReviewOnly = true
  | 'skip_recruiter_touched'    // рекрутер уже двигал заявку
  | 'skip_not_in_root'          // заявка не в корне «неразобранные» (уже двигалась/hm_review/дальше)
  | 'skip_no_hm_review_stage'   // подэтап hm_review отсутствует/скрыт
  | 'error'                     // внутренняя ошибка

export interface AutoAdvanceResult {
  outcome: AutoAdvanceOutcome
  meta?: {
    score?: number | null
    threshold?: number | null
    confidence?: number | null
    targetStageId?: string
    targetStageName?: string
  }
}

/**
 * Применить правило авто-передвижения к одной заявке.
 * Вызывается СРАЗУ после того, как новые scores записаны в БД и
 * ПОСЛЕ applyAutoRejectIfNeeded (правила не пересекаются: reject срабатывает
 * при score < N, advance — при score >= M, обычно M > N, но и при M == N
 * порядок вызова гарантирует непротиворечивость).
 */
export async function applyAutoAdvanceIfNeeded(
  applicationId: string,
  orgId: string,
  evaluationsHint?: {
    criteria: CriterionDefinition[]
    evaluations: CriterionEvaluation[]
  },
): Promise<AutoAdvanceResult> {
  try {
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
            autoAdvanceEnabled: true,
            autoAdvanceAboveScore: true,
            autoAdvanceReasonNote: true,
          },
        },
        currentStage: {
          columns: {
            id: true, isTerminal: true, type: true, name: true,
            parentStageId: true, presetKey: true,
          },
        },
      },
    })

    if (!app) {
      return { outcome: 'error', meta: {} }
    }

    // G1: правило выключено
    if (!app.job.autoAdvanceEnabled) {
      return { outcome: 'skip_disabled' }
    }

    // G2: порог не задан или некорректен
    const threshold = app.job.autoAdvanceAboveScore
    if (threshold === null || threshold === undefined || threshold < 0 || threshold > 100) {
      return { outcome: 'skip_no_threshold', meta: { threshold } }
    }

    // G3: VIP-кандидат
    if (app.candidate.manualReviewOnly) {
      return { outcome: 'skip_manual_review_only', meta: { score: app.score, threshold } }
    }

    // G4: двигаем только из корня «Все неразобранные» (тип new без parent).
    // Если заявка уже в подэтапе, у другого этапа, в терминале — не трогаем.
    if (!app.currentStage
      || app.currentStage.isTerminal
      || app.currentStage.parentStageId !== null
      || app.currentStage.type !== 'new') {
      return { outcome: 'skip_not_in_root', meta: { score: app.score, threshold } }
    }

    // G5: рекрутер уже двигал заявку (записи с movedByUserId + fromStageId ≠ NULL)
    const recruiterTouch = await db.query.applicationStageHistory.findFirst({
      where: and(
        eq(applicationStageHistory.applicationId, applicationId),
        eq(applicationStageHistory.organizationId, orgId),
        isNotNull(applicationStageHistory.movedByUserId),
        isNotNull(applicationStageHistory.fromStageId),
      ),
      columns: { id: true },
    })
    if (recruiterTouch) {
      return { outcome: 'skip_recruiter_touched', meta: { score: app.score, threshold } }
    }

    // G6: score
    if (app.score === null || app.score === undefined) {
      return { outcome: 'skip_no_score', meta: { threshold } }
    }
    if (app.score < threshold) {
      return { outcome: 'skip_below_threshold', meta: { score: app.score, threshold } }
    }

    // Композитная уверенность (тот же путь, что в autoReject)
    let confidence: number
    if (evaluationsHint) {
      confidence = computeCompositeConfidence(evaluationsHint.criteria, evaluationsHint.evaluations)
    }
    else {
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

    // G7: низкая уверенность — не двигаем «наверх»
    if (confidence < MIN_CONFIDENCE_FOR_AUTO_ADVANCE) {
      return {
        outcome: 'skip_low_confidence',
        meta: { score: app.score, threshold, confidence },
      }
    }

    // G8: наличие подэтапа hm_review в воронке
    if (!app.job.pipelineId) {
      return { outcome: 'skip_no_hm_review_stage', meta: { score: app.score, threshold, confidence } }
    }
    const hmReview = await resolveHmReviewStage({
      organizationId: orgId,
      pipelineId: app.job.pipelineId,
    })
    if (!hmReview) {
      return { outcome: 'skip_no_hm_review_stage', meta: { score: app.score, threshold, confidence } }
    }

    // Всё зелёное — двигаем через канонический утиль
    const reasonComment = buildAutoAdvanceComment(app.score, threshold, confidence, app.job.autoAdvanceReasonNote)

    await moveApplicationStage({
      organizationId: orgId,
      applicationId,
      toStageId: hmReview.stageId,
      actorUserId: null, // system actor
      comment: reasonComment,
      via: 'auto_advance',
      activityMetadataExtras: { auto: true },
    })

    return {
      outcome: 'advanced',
      meta: {
        score: app.score,
        threshold,
        confidence,
        targetStageId: hmReview.stageId,
        targetStageName: hmReview.stageName,
      },
    }
  }
  catch (err) {
    logWarn?.('auto_advance.failed', {
      application_id: applicationId,
      org_id: orgId,
      error_message: err instanceof Error ? err.message : String(err),
    }) ?? console.warn('[auto_advance.failed]', applicationId, err)
    return { outcome: 'error' }
  }
}

function buildAutoAdvanceComment(
  score: number,
  threshold: number,
  confidence: number,
  customNote: string | null | undefined,
): string {
  const base = `Авто-передвижение по AI-скору: ${score}/100 не ниже порога ${threshold}/100 (уверенность ${confidence}%).`
  return customNote && customNote.trim().length > 0
    ? `${base} ${customNote.trim()}`
    : base
}
