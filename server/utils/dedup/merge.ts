import { and, eq, sql } from 'drizzle-orm'
import {
  candidate,
  candidateIdentity,
  candidateMergeLog,
  candidateResumeVersion,
  candidateDuplicateCandidate,
  application,
  document,
} from '../../database/schema'
import { getOrgGroupId } from './resolve'

/**
 * Параметры слияния двух кандидатов.
 * primary остаётся «живым», merged помечается как merged → primary.
 */
export interface MergeCandidatesParams {
  primaryCandidateId: string
  mergedCandidateId: string
  userId: string | null
  /** Опционально: id строки candidate_duplicate_candidate, по которой инициировано слияние. */
  pairId?: string | null
  /** Опционально: краткое описание причины (текст). */
  reason?: string | null
  /** Опционально: сигналы, по которым решили мерджить (для аудита). */
  signals?: Array<{ kind: string; value: string; score?: number }>
  /** Опционально: интегральный fuzzy-скор пары, если из очереди. */
  score?: number | null
  /** 'auto' | 'manual' — для аудита. По умолчанию 'manual'. */
  mergeKind?: 'auto' | 'manual'
}

export interface MergeResult {
  ok: true
  mergeLogId: string
  primaryCandidateId: string
  mergedCandidateId: string
  transferred: {
    applications: number
    applicationsDeletedAsDuplicates: number
    documents: number
    identities: number
    resumeVersions: number
  }
}

/**
 * Сливает merged-кандидата в primary-кандидата в рамках одной транзакции.
 *
 * Шаги:
 *  1. Валидация: оба активны, не один и тот же, из одной org или одной группы.
 *  2. Снимок обоих кандидатов в jsonb (для rollback).
 *  3. Перенос applications с учётом unique(org, candidate, job).
 *  4. Перенос documents (cascade FK — просто UPDATE).
 *  5. Перенос candidate_identity.
 *  6. Resume-версии merged-кандидата помечаются mergedFromCandidateId = merged.id
 *     (candidate_id не меняем — оставляем историю на исходном кандидате,
 *      а доступ из primary получаем по mergedFromCandidateId).
 *  7. Помечаем merged: mergeStatus='merged', mergedIntoId=primary, mergedAt=now.
 *  8. Пишем запись candidate_merge_log (action='merge', rollbackUntil = now+30d).
 *  9. Если передан pairId — обновляем candidate_duplicate_candidate.status='merged'.
 */
export async function mergeCandidates(params: MergeCandidatesParams): Promise<MergeResult> {
  const {
    primaryCandidateId,
    mergedCandidateId,
    userId,
    pairId,
    reason,
    signals = [],
    score = null,
    mergeKind = 'manual',
  } = params

  if (primaryCandidateId === mergedCandidateId) {
    throw createError({ statusCode: 400, statusMessage: 'Нельзя слить кандидата с самим собой' })
  }

  // 1. Подтянем обоих кандидатов
  const [primary] = await db.select().from(candidate).where(eq(candidate.id, primaryCandidateId)).limit(1)
  const [merged] = await db.select().from(candidate).where(eq(candidate.id, mergedCandidateId)).limit(1)
  if (!primary) throw createError({ statusCode: 404, statusMessage: 'Primary кандидат не найден' })
  if (!merged) throw createError({ statusCode: 404, statusMessage: 'Merged кандидат не найден' })
  if (primary.mergeStatus === 'merged') {
    throw createError({ statusCode: 400, statusMessage: 'Primary кандидат уже слит — выберите другого' })
  }
  if (merged.mergeStatus === 'merged') {
    throw createError({ statusCode: 400, statusMessage: 'Merged кандидат уже слит ранее' })
  }

  // 2. Проверка группы: либо одна org, либо одна group
  if (primary.organizationId !== merged.organizationId) {
    const primaryGroup = await getOrgGroupId(primary.organizationId)
    const mergedGroup = await getOrgGroupId(merged.organizationId)
    if (!primaryGroup || !mergedGroup || primaryGroup !== mergedGroup) {
      throw createError({ statusCode: 400, statusMessage: 'Кандидаты из разных групп — слияние невозможно' })
    }
  }

  // 3. Снимок до изменений
  const snapshot = {
    primary: { ...primary },
    merged: { ...merged },
    takenAt: new Date().toISOString(),
  }

  // 4. Транзакция
  return await db.transaction(async (tx) => {
    // 4a. Applications: проходим по всем merged.applications,
    //     если в primary уже есть application на тот же job → удаляем дубликат у merged,
    //     иначе переносим.
    const mergedApps = await tx.select({ id: application.id, jobId: application.jobId, organizationId: application.organizationId })
      .from(application)
      .where(eq(application.candidateId, mergedCandidateId))

    let appsTransferred = 0
    let appsDeleted = 0
    for (const app of mergedApps) {
      // ищем коллизию у primary по (org, candidate=primary, job)
      const [collision] = await tx.select({ id: application.id })
        .from(application)
        .where(and(
          eq(application.organizationId, app.organizationId),
          eq(application.candidateId, primaryCandidateId),
          eq(application.jobId, app.jobId),
        ))
        .limit(1)
      if (collision) {
        await tx.delete(application).where(eq(application.id, app.id))
        appsDeleted += 1
      }
      else {
        await tx.update(application)
          .set({ candidateId: primaryCandidateId })
          .where(eq(application.id, app.id))
        appsTransferred += 1
      }
    }

    // 4b. Documents
    const docRows = await tx.update(document)
      .set({ candidateId: primaryCandidateId })
      .where(eq(document.candidateId, mergedCandidateId))
      .returning({ id: document.id })
    const docsTransferred = docRows.length

    // 4c. Identities — у каждого нужно проверить дубликат (group_id, kind, value_normalized)
    //    Если такая identity уже есть у primary — просто удалим у merged.
    //    Иначе перепривяжем к primary.
    const mergedIdentities = await tx.select().from(candidateIdentity)
      .where(eq(candidateIdentity.candidateId, mergedCandidateId))
    let identitiesTransferred = 0
    for (const idn of mergedIdentities) {
      // ищем коллизию у primary
      const where = idn.groupId
        ? and(
            eq(candidateIdentity.candidateId, primaryCandidateId),
            eq(candidateIdentity.groupId, idn.groupId),
            eq(candidateIdentity.kind, idn.kind),
            eq(candidateIdentity.valueNormalized, idn.valueNormalized),
          )
        : and(
            eq(candidateIdentity.candidateId, primaryCandidateId),
            eq(candidateIdentity.kind, idn.kind),
            eq(candidateIdentity.valueNormalized, idn.valueNormalized),
          )
      const [collision] = await tx.select({ id: candidateIdentity.id }).from(candidateIdentity).where(where).limit(1)
      if (collision) {
        await tx.delete(candidateIdentity).where(eq(candidateIdentity.id, idn.id))
      }
      else {
        await tx.update(candidateIdentity)
          .set({ candidateId: primaryCandidateId })
          .where(eq(candidateIdentity.id, idn.id))
        identitiesTransferred += 1
      }
    }

    // 4d. Resume versions — помечаем mergedFromCandidateId
    const verRows = await tx.update(candidateResumeVersion)
      .set({ mergedFromCandidateId: mergedCandidateId })
      .where(eq(candidateResumeVersion.candidateId, mergedCandidateId))
      .returning({ id: candidateResumeVersion.id })
    const versionsTouched = verRows.length

    // 4e. Помечаем merged-кандидата
    await tx.update(candidate)
      .set({
        mergeStatus: 'merged',
        mergedIntoId: primaryCandidateId,
        mergedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(candidate.id, mergedCandidateId))

    // 4f. Лог
    const rollbackUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    const primaryGroupId = await getOrgGroupId(primary.organizationId)
    const [logRow] = await tx.insert(candidateMergeLog).values({
      organizationId: primary.organizationId,
      groupId: primaryGroupId,
      primaryCandidateId,
      mergedCandidateId,
      performedByUserId: userId,
      action: 'merge',
      mergeKind,
      reason: reason ?? null,
      signals,
      score,
      snapshot,
      rollbackUntil,
    }).returning({ id: candidateMergeLog.id })

    // 4g. Обновляем пару, если есть
    if (pairId) {
      await tx.update(candidateDuplicateCandidate)
        .set({
          status: 'merged',
          decidedByUserId: userId,
          decidedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(candidateDuplicateCandidate.id, pairId))
    }
    // Все остальные pending-пары, где участвует merged-кандидат — тоже переводим в 'merged'
    // (они теперь неактуальны: merged исчез).
    await tx.update(candidateDuplicateCandidate)
      .set({
        status: 'merged',
        decidedByUserId: userId,
        decidedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(
        eq(candidateDuplicateCandidate.status, 'pending'),
        sql`(${candidateDuplicateCandidate.candidateIdA} = ${mergedCandidateId} OR ${candidateDuplicateCandidate.candidateIdB} = ${mergedCandidateId})`,
      ))

    return {
      ok: true as const,
      mergeLogId: logRow!.id,
      primaryCandidateId,
      mergedCandidateId,
      transferred: {
        applications: appsTransferred,
        applicationsDeletedAsDuplicates: appsDeleted,
        documents: docsTransferred,
        identities: identitiesTransferred,
        resumeVersions: versionsTouched,
      },
    }
  })
}
