import { and, eq, sql } from 'drizzle-orm'
import {
  candidate,
  candidateIdentity,
  candidateMergeLog,
  candidateResumeVersion,
  candidateDuplicateCandidate,
  application,
  applicationStageHistory,
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
    stageHistoryMerged: number
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
  if (!primary) throw createError({ statusCode: 404, statusMessage: 'Основной кандидат не найден' })
  if (!merged) throw createError({ statusCode: 404, statusMessage: 'Объединяемый кандидат не найден' })
  if (primary.mergeStatus === 'merged') {
    throw createError({ statusCode: 400, statusMessage: 'Основной кандидат уже объединён — выберите другого' })
  }
  if (merged.mergeStatus === 'merged') {
    throw createError({ statusCode: 400, statusMessage: 'Объединяемый кандидат уже объединён ранее' })
  }

  // 2. Проверка группы: либо одна org, либо одна group
  if (primary.organizationId !== merged.organizationId) {
    const primaryGroup = await getOrgGroupId(primary.organizationId)
    const mergedGroup = await getOrgGroupId(merged.organizationId)
    if (!primaryGroup || !mergedGroup || primaryGroup !== mergedGroup) {
      throw createError({ statusCode: 400, statusMessage: 'Кандидаты из разных групп — слияние невозможно' })
    }
  }

  // 3. Снимок до изменений (пополнится внутри транзакции перенесёнными ID)
  const snapshot: {
    primary: typeof primary
    merged: typeof merged
    takenAt: string
    transferred?: {
      applicationIds: string[]
      applicationsDeleted: string[]
      documentIds: string[]
      identityIds: string[]
      resumeVersionIds: string[]
      stageHistoryMoves?: Array<{ fromAppId: string, toAppId: string, historyIds: string[] }>
    }
  } = {
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

    const transferredAppIds: string[] = []
    const deletedAppIds: string[] = []
    /** Сохраняем перенесённую историю стадий: { from_app_id, history_id } для возможного rollback */
    const transferredHistoryIds: Array<{ fromAppId: string, toAppId: string, historyIds: string[] }> = []
    let appsTransferred = 0
    let appsDeleted = 0
    let stageHistoryMerged = 0
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
        // P1.2: переносим историю стадий удаляемой application в primary application
        // ДО удаления (иначе ON DELETE CASCADE снесёт строки навсегда).
        const movedRows = await tx.update(applicationStageHistory)
          .set({
            applicationId: collision.id,
            comment: sql`COALESCE(${applicationStageHistory.comment} || E'\n', '') || '[merged from ' || ${app.id} || ']'`,
          })
          .where(eq(applicationStageHistory.applicationId, app.id))
          .returning({ id: applicationStageHistory.id })
        if (movedRows.length > 0) {
          transferredHistoryIds.push({ fromAppId: app.id, toAppId: collision.id, historyIds: movedRows.map(r => r.id) })
          stageHistoryMerged += movedRows.length
        }
        await tx.delete(application).where(eq(application.id, app.id))
        deletedAppIds.push(app.id)
        appsDeleted += 1
      }
      else {
        await tx.update(application)
          .set({ candidateId: primaryCandidateId })
          .where(eq(application.id, app.id))
        transferredAppIds.push(app.id)
        appsTransferred += 1
      }
    }

    // 4b. Documents
    const docRows = await tx.update(document)
      .set({ candidateId: primaryCandidateId })
      .where(eq(document.candidateId, mergedCandidateId))
      .returning({ id: document.id })
    const docsTransferred = docRows.length
    const transferredDocIds = docRows.map(r => r.id)

    // 4c. Identities — у каждого нужно проверить дубликат (group_id, kind, value_normalized)
    //    Если такая identity уже есть у primary — просто удалим у merged.
    //    Иначе перепривяжем к primary.
    const mergedIdentities = await tx.select().from(candidateIdentity)
      .where(eq(candidateIdentity.candidateId, mergedCandidateId))
    let identitiesTransferred = 0
    const transferredIdentityIds: string[] = []
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
        transferredIdentityIds.push(idn.id)
        identitiesTransferred += 1
      }
    }

    // 4d. Resume versions — помечаем mergedFromCandidateId
    const verRows = await tx.update(candidateResumeVersion)
      .set({ mergedFromCandidateId: mergedCandidateId })
      .where(eq(candidateResumeVersion.candidateId, mergedCandidateId))
      .returning({ id: candidateResumeVersion.id })
    const versionsTouched = verRows.length
    const transferredVersionIds = verRows.map(r => r.id)

    // Собираем перенесённые ID в snapshot — нужны для rollbackа
    snapshot.transferred = {
      applicationIds: transferredAppIds,
      applicationsDeleted: deletedAppIds,
      documentIds: transferredDocIds,
      identityIds: transferredIdentityIds,
      resumeVersionIds: transferredVersionIds,
      stageHistoryMoves: transferredHistoryIds, // P1.2: для rollback истории стадий
    }

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
        stageHistoryMerged, // P1.2: сколько записей истории стадий было склеено
      },
    }
  })
}

// ──────────────────────────────────────────────────────────────────────────────────
// Rollback merge (P1.1)
// ──────────────────────────────────────────────────────────────────────────────────

export interface RollbackMergeParams {
  mergeLogId: string
  userId: string | null
  reason?: string | null
}

export interface RollbackResult {
  ok: true
  rollbackLogId: string
  primaryCandidateId: string
  mergedCandidateId: string
  restored: {
    applications: number
    documents: number
    identities: number
    resumeVersions: number
    stageHistoryRemoved: number
  }
}

/**
 * Откат слияния по merge_log.id.
 *
 * Гарантии:
 *  — Откатывает только записи c action='merge' и rollback_until > now().
 *  — Идемпотентно: если уже есть action='rollback' для этой пары — ошибка.
 *  — Работает только с обогащённым snapshot (transferred.* с ID сущностей).
 *    Старые merge-логи без transferred-поля откатить нельзя.
 *  — Транзакция: пишет отдельную запись в merge_log с action='rollback'.
 */
export async function rollbackMerge(params: RollbackMergeParams): Promise<RollbackResult> {
  const { mergeLogId, userId, reason } = params

  // 1. Забираем merge-запись
  const [log] = await db.select().from(candidateMergeLog).where(eq(candidateMergeLog.id, mergeLogId)).limit(1)
  if (!log) throw createError({ statusCode: 404, statusMessage: 'Запись слияния не найдена' })
  if (log.action !== 'merge') {
    throw createError({ statusCode: 400, statusMessage: 'Откат возможен только для записей слияния' })
  }

  // 2. Окно отката
  if (!log.rollbackUntil || new Date(log.rollbackUntil).getTime() <= Date.now()) {
    throw createError({ statusCode: 400, statusMessage: 'Окно отката истекло' })
  }

  // 3. Не было ли уже отката для этой пары
  const [existingRb] = await db.select({ id: candidateMergeLog.id })
    .from(candidateMergeLog)
    .where(and(
      eq(candidateMergeLog.action, 'rollback'),
      eq(candidateMergeLog.primaryCandidateId, log.primaryCandidateId),
      eq(candidateMergeLog.mergedCandidateId, log.mergedCandidateId),
    ))
    .limit(1)
  if (existingRb) {
    throw createError({ statusCode: 400, statusMessage: 'Это слияние уже откачено ранее' })
  }

  // 4. Разбор snapshot
  const snap = log.snapshot as {
    primary: { id: string }
    merged: { id: string }
    transferred?: {
      applicationIds?: string[]
      documentIds?: string[]
      identityIds?: string[]
      resumeVersionIds?: string[]
      stageHistoryMoves?: Array<{ fromAppId: string, toAppId: string, historyIds: string[] }>
    }
  } | null
  if (!snap?.transferred) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Слияние выполнено в старой версии — автоматический откат невозможен',
    })
  }

  const primaryId = log.primaryCandidateId
  const mergedId = log.mergedCandidateId
  const t = snap.transferred

  // 5. Транзакция восстановления
  return await db.transaction(async (tx) => {
    // 5a. Вернуть application.candidate_id = mergedId для перенесённых
    let appsRestored = 0
    if (t.applicationIds?.length) {
      const res = await tx.update(application)
        .set({ candidateId: mergedId })
        .where(and(
          eq(application.candidateId, primaryId),
          sql`${application.id} IN (${sql.join(t.applicationIds.map(id => sql`${id}`), sql`, `)})`,
        ))
        .returning({ id: application.id })
      appsRestored = res.length
    }
    // Примечание: applications, удалённые как дубликаты (deletedAppIds), восстановить нельзя —
    // это будет в UI предупреждением.

    // 5b. Документы
    let docsRestored = 0
    if (t.documentIds?.length) {
      const res = await tx.update(document)
        .set({ candidateId: mergedId })
        .where(and(
          eq(document.candidateId, primaryId),
          sql`${document.id} IN (${sql.join(t.documentIds.map(id => sql`${id}`), sql`, `)})`,
        ))
        .returning({ id: document.id })
      docsRestored = res.length
    }

    // 5c. Identities
    let identitiesRestored = 0
    if (t.identityIds?.length) {
      const res = await tx.update(candidateIdentity)
        .set({ candidateId: mergedId })
        .where(and(
          eq(candidateIdentity.candidateId, primaryId),
          sql`${candidateIdentity.id} IN (${sql.join(t.identityIds.map(id => sql`${id}`), sql`, `)})`,
        ))
        .returning({ id: candidateIdentity.id })
      identitiesRestored = res.length
    }

    // 5d.1. Stage history (P1.2): удаляем ранее склеенные строки.
    // merged-application была удалена во время merge, вернуть их «домой» нельзя.
    let stageHistoryRemoved = 0
    if (t.stageHistoryMoves?.length) {
      const allHistoryIds = t.stageHistoryMoves.flatMap(m => m.historyIds)
      if (allHistoryIds.length) {
        const res = await tx.delete(applicationStageHistory)
          .where(sql`${applicationStageHistory.id} IN (${sql.join(allHistoryIds.map(id => sql`${id}`), sql`, `)})`)
          .returning({ id: applicationStageHistory.id })
        stageHistoryRemoved = res.length
      }
    }

    // 5d. Resume versions — сбросить mergedFromCandidateId
    let versionsRestored = 0
    if (t.resumeVersionIds?.length) {
      const res = await tx.update(candidateResumeVersion)
        .set({ mergedFromCandidateId: null })
        .where(and(
          eq(candidateResumeVersion.candidateId, mergedId),
          sql`${candidateResumeVersion.id} IN (${sql.join(t.resumeVersionIds.map(id => sql`${id}`), sql`, `)})`,
        ))
        .returning({ id: candidateResumeVersion.id })
      versionsRestored = res.length
    }

    // 5e. Реактивируем merged-кандидата
    await tx.update(candidate)
      .set({
        mergeStatus: 'active',
        mergedIntoId: null,
        mergedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(candidate.id, mergedId))

    // 5f. Лог rollback
    const [rbLog] = await tx.insert(candidateMergeLog).values({
      organizationId: log.organizationId,
      groupId: log.groupId,
      primaryCandidateId: primaryId,
      mergedCandidateId: mergedId,
      performedByUserId: userId,
      action: 'rollback',
      mergeKind: log.mergeKind,
      reason: reason ?? null,
      signals: log.signals,
      score: log.score,
      snapshot: {
        rollbackOf: mergeLogId,
        restoredAt: new Date().toISOString(),
        restored: {
          applicationIds: t.applicationIds ?? [],
          documentIds: t.documentIds ?? [],
          identityIds: t.identityIds ?? [],
          resumeVersionIds: t.resumeVersionIds ?? [],
          stageHistoryRemoved, // P1.2
        },
      },
      rollbackUntil: null,
    }).returning({ id: candidateMergeLog.id })

    // 5g. Открываем пару обратно в pending (если была status='merged')
    await tx.update(candidateDuplicateCandidate)
      .set({
        status: 'pending',
        decidedByUserId: null,
        decidedAt: null,
        updatedAt: new Date(),
      })
      .where(and(
        eq(candidateDuplicateCandidate.status, 'merged'),
        sql`((${candidateDuplicateCandidate.candidateIdA} = ${primaryId} AND ${candidateDuplicateCandidate.candidateIdB} = ${mergedId}) OR (${candidateDuplicateCandidate.candidateIdA} = ${mergedId} AND ${candidateDuplicateCandidate.candidateIdB} = ${primaryId}))`,
      ))

    return {
      ok: true as const,
      rollbackLogId: rbLog!.id,
      primaryCandidateId: primaryId,
      mergedCandidateId: mergedId,
      restored: {
        applications: appsRestored,
        documents: docsRestored,
        identities: identitiesRestored,
        resumeVersions: versionsRestored,
        stageHistoryRemoved,
      },
    }
  })
}
