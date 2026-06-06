import { and, desc, eq, sql } from 'drizzle-orm'
import { candidateResumeVersion } from '../../database/schema'
import { computeResumeContentHash } from './hash'
import { computeResumeDelta, type ResumeDelta } from './delta'

/** Дебаунс: не создавать новые версии чаще, чем раз в DEBOUNCE_MS на кандидата. */
const DEBOUNCE_MS = 60 * 60 * 1000 // 1 час

export interface AppendVersionResult {
  /** Действие, которое было выполнено */
  action: 'created' | 'unchanged' | 'debounced' | 'no_snapshot'
  /** id новой/текущей версии (если применимо) */
  versionId?: string
  /** Номер новой/текущей версии */
  versionNumber?: number
  /** content_hash текущей версии */
  contentHash?: string
  /** Дельта от предыдущей версии (если была создана новая) */
  delta?: ResumeDelta
}

export interface AppendVersionInput {
  candidateId: string
  raw: Record<string, unknown> | null | undefined
  source?: 'hh' | 'manual_upload' | 'api_import'
  triggeredBy?: string
  /** resume.updated_at от hh, если есть */
  hhUpdatedAt?: Date | null
  /**
   * Если true — пропустить дебаунс (например, ручное обновление через UI).
   * По умолчанию false (auto-sync уважает дебаунс).
   */
  bypassDebounce?: boolean
}

/**
 * Идемпотентное добавление новой версии резюме.
 *
 * Алгоритм:
 *   1. Если raw отсутствует — no_snapshot, ничего не делаем
 *   2. Считаем стабильный hash от raw
 *   3. Берём текущую версию (is_current = true) кандидата
 *   4. Если hash совпадает — unchanged, обновляем только fetchedAt текущей
 *   5. Если hash отличается, но текущая создана < 1 час назад И не bypassDebounce —
 *      debounced (обновляем snapshot+hash текущей версии, не создавая новую)
 *   6. Иначе создаём новую версию v(N+1), помечаем is_current = true, старую — false
 *
 * Транзакционная безопасность: уникальный индекс на (candidate_id) WHERE is_current = true
 * гарантирует, что не будет двух current-версий одновременно.
 */
export async function appendResumeVersionIfChanged(
  input: AppendVersionInput,
): Promise<AppendVersionResult> {
  const { candidateId, raw, hhUpdatedAt, bypassDebounce = false } = input
  const source = input.source ?? 'hh'
  const triggeredBy = input.triggeredBy ?? 'auto-sync'

  if (!raw) return { action: 'no_snapshot' }

  const contentHash = computeResumeContentHash(raw)

  return await db.transaction(async (tx) => {
    // Берём ВСЕ версии кандидата отсортированные desc, чтобы вычислить maxNumber и узнать current
    const versions = await tx
      .select({
        id: candidateResumeVersion.id,
        versionNumber: candidateResumeVersion.versionNumber,
        contentHash: candidateResumeVersion.contentHash,
        snapshot: candidateResumeVersion.snapshot,
        isCurrent: candidateResumeVersion.isCurrent,
        fetchedAt: candidateResumeVersion.fetchedAt,
        createdAt: candidateResumeVersion.createdAt,
      })
      .from(candidateResumeVersion)
      .where(eq(candidateResumeVersion.candidateId, candidateId))
      .orderBy(desc(candidateResumeVersion.versionNumber))

    const current = versions.find(v => v.isCurrent) ?? versions[0]
    const maxNumber = versions.length > 0 ? versions[0]!.versionNumber : 0

    // Кейс 1: версий ещё нет → создаём v1
    if (!current) {
      const delta = computeResumeDelta(null, raw)
      const [created] = await tx
        .insert(candidateResumeVersion)
        .values({
          candidateId,
          versionNumber: 1,
          source,
          contentHash,
          snapshot: raw,
          deltaSummary: delta as unknown as Record<string, unknown>,
          hhUpdatedAt: hhUpdatedAt ?? null,
          isCurrent: true,
          triggeredBy,
        })
        .returning({ id: candidateResumeVersion.id, versionNumber: candidateResumeVersion.versionNumber })
      return {
        action: 'created' as const,
        versionId: created!.id,
        versionNumber: created!.versionNumber,
        contentHash,
        delta,
      }
    }

    // Кейс 2: hash совпадает → unchanged, обновляем fetchedAt
    if (current.contentHash === contentHash) {
      await tx
        .update(candidateResumeVersion)
        .set({ fetchedAt: new Date(), hhUpdatedAt: hhUpdatedAt ?? current.fetchedAt })
        .where(eq(candidateResumeVersion.id, current.id))
      return {
        action: 'unchanged' as const,
        versionId: current.id,
        versionNumber: current.versionNumber,
        contentHash,
      }
    }

    // Кейс 3: hash отличается, но дебаунс ещё не истёк → обновляем текущую in-place
    const ageMs = Date.now() - new Date(current.createdAt).getTime()
    if (!bypassDebounce && ageMs < DEBOUNCE_MS) {
      const delta = computeResumeDelta(current.snapshot as Record<string, unknown>, raw)
      await tx
        .update(candidateResumeVersion)
        .set({
          contentHash,
          snapshot: raw,
          deltaSummary: delta as unknown as Record<string, unknown>,
          fetchedAt: new Date(),
          hhUpdatedAt: hhUpdatedAt ?? null,
        })
        .where(eq(candidateResumeVersion.id, current.id))
      return {
        action: 'debounced' as const,
        versionId: current.id,
        versionNumber: current.versionNumber,
        contentHash,
        delta,
      }
    }

    // Кейс 4: создаём новую версию v(N+1)
    const delta = computeResumeDelta(current.snapshot as Record<string, unknown>, raw)

    // Сначала снимаем флаг is_current с текущей (важно для unique-индекса)
    await tx
      .update(candidateResumeVersion)
      .set({ isCurrent: false })
      .where(and(
        eq(candidateResumeVersion.candidateId, candidateId),
        eq(candidateResumeVersion.isCurrent, true),
      ))

    const [created] = await tx
      .insert(candidateResumeVersion)
      .values({
        candidateId,
        versionNumber: maxNumber + 1,
        source,
        contentHash,
        snapshot: raw,
        deltaSummary: delta as unknown as Record<string, unknown>,
        hhUpdatedAt: hhUpdatedAt ?? null,
        isCurrent: true,
        triggeredBy,
      })
      .returning({ id: candidateResumeVersion.id, versionNumber: candidateResumeVersion.versionNumber })

    return {
      action: 'created' as const,
      versionId: created!.id,
      versionNumber: created!.versionNumber,
      contentHash,
      delta,
    }
  })
}

/** Подсчёт количества версий у кандидата (для UI badge). */
export async function countResumeVersions(candidateId: string): Promise<number> {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(candidateResumeVersion)
    .where(eq(candidateResumeVersion.candidateId, candidateId))
  return count ?? 0
}
