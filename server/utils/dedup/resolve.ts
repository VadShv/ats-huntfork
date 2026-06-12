import { and, eq, inArray, isNull } from 'drizzle-orm'
import { candidate, candidateIdentity, organizationExt } from '../../database/schema'
import type { IdentitySignal } from './extract'

/**
 * Порядок «силы» сигнала — чем выше в списке, тем сильнее.
 * Используется когда разные сигналы привели к разным кандидатам:
 *   выигрывает наиболее «сильный» источник.
 */
const KIND_PRIORITY: Record<IdentitySignal['kind'], number> = {
  hh_resume: 100,
  hh_owner: 90,
  phone: 80,
  linkedin: 70,
  email: 60,
  telegram: 50,
  manual_external: 10,
}

export interface ResolveResult {
  /** Найден существующий кандидат — переиспользуем его id. */
  candidateId: string | null
  /** True — нашли через несколько сигналов, и они указывают на разных кандидатов. */
  hasConflict: boolean
  /** Все найденные совпадения (для логирования / разрешения конфликта). */
  matches: Array<{ candidateId: string; kind: IdentitySignal['kind']; valueNormalized: string }>
}

/**
 * Ищем кандидата в рамках группы по списку identity-сигналов.
 * Возвращает id первого «сильного» совпадения или null если ничего не нашли.
 * Если разные сигналы указывают на разных кандидатов — hasConflict=true (вернём «сильнейшего»).
 */
export async function resolveCandidateBySignals(
  groupId: string | null,
  signals: IdentitySignal[],
): Promise<ResolveResult> {
  if (signals.length === 0) return { candidateId: null, hasConflict: false, matches: [] }

  // Если groupId неизвестен — ищем глобально (по всем org), но это деградация:
  // лучше bootstrap так, чтобы у каждой org был group_id.
  // Делаем поиск только по сигналам с непустым valueNormalized.
  const valuesByKind = new Map<string, string[]>()
  for (const s of signals) {
    if (!s.valueNormalized) continue
    const arr = valuesByKind.get(s.kind) ?? []
    arr.push(s.valueNormalized)
    valuesByKind.set(s.kind, arr)
  }

  if (valuesByKind.size === 0) return { candidateId: null, hasConflict: false, matches: [] }

  // Один запрос: WHERE (group_id = X OR group_id IS NULL fallback) AND (kind, value) IN (...)
  // Drizzle inArray на кортежах сложен — делаем по kind отдельно и объединяем результаты.
  const allRows: Array<{ candidateId: string; kind: string; valueNormalized: string }> = []
  for (const [kind, values] of valuesByKind) {
    const baseWhere = groupId
      ? and(eq(candidateIdentity.groupId, groupId), eq(candidateIdentity.kind, kind), inArray(candidateIdentity.valueNormalized, values))
      : and(isNull(candidateIdentity.groupId), eq(candidateIdentity.kind, kind), inArray(candidateIdentity.valueNormalized, values))
    const rows = await db
      .select({
        candidateId: candidateIdentity.candidateId,
        kind: candidateIdentity.kind,
        valueNormalized: candidateIdentity.valueNormalized,
      })
      .from(candidateIdentity)
      .where(baseWhere)
    allRows.push(...rows)
  }

  if (allRows.length === 0) return { candidateId: null, hasConflict: false, matches: [] }

  // Уберём кандидатов в статусе 'merged' — у них есть primary, на которого надо указывать
  const candidateIds = Array.from(new Set(allRows.map(r => r.candidateId)))
  const candRows = await db
    .select({ id: candidate.id, mergeStatus: candidate.mergeStatus, mergedIntoId: candidate.mergedIntoId })
    .from(candidate)
    .where(inArray(candidate.id, candidateIds))
  const redirect = new Map<string, string>() // mergedId -> primaryId
  for (const c of candRows) {
    if (c.mergeStatus === 'merged' && c.mergedIntoId) {
      redirect.set(c.id, c.mergedIntoId)
    }
  }

  // Применим редирект: если matched candidate merged, используем primary
  const resolved = allRows.map(r => ({
    ...r,
    candidateId: redirect.get(r.candidateId) ?? r.candidateId,
  }))

  // Группируем: какой candidate-id даёт какой kind
  const idsSet = new Set(resolved.map(r => r.candidateId))
  const hasConflict = idsSet.size > 1

  // Выбираем «сильнейшего»: сортируем сигналы по priority kind и берём первого
  resolved.sort((a, b) =>
    (KIND_PRIORITY[b.kind as IdentitySignal['kind']] ?? 0)
    - (KIND_PRIORITY[a.kind as IdentitySignal['kind']] ?? 0),
  )

  return {
    candidateId: resolved[0]?.candidateId ?? null,
    hasConflict,
    matches: resolved as Array<{ candidateId: string; kind: IdentitySignal['kind']; valueNormalized: string }>,
  }
}

/**
 * Upsert набора identity для существующего кандидата.
 * Если такая identity уже есть — обновляем last_seen_at, иначе вставляем.
 *
 * Использует ON CONFLICT по уникальному индексу (group_id, kind, value_normalized) WHERE group_id IS NOT NULL.
 * Для group_id IS NULL fallback (когда orgs ещё не привязаны к группе) — делаем select-then-insert.
 */
export async function upsertCandidateIdentities(params: {
  candidateId: string
  organizationId: string
  groupId: string | null
  signals: IdentitySignal[]
}): Promise<{ inserted: number; updated: number }> {
  let inserted = 0
  let updated = 0
  const now = new Date()
  for (const s of params.signals) {
    if (!s.valueNormalized) continue
    // Сначала пробуем найти существующую запись (в рамках группы или для этого кандидата)
    const where = params.groupId
      ? and(
          eq(candidateIdentity.groupId, params.groupId),
          eq(candidateIdentity.kind, s.kind),
          eq(candidateIdentity.valueNormalized, s.valueNormalized),
        )
      : and(
          eq(candidateIdentity.candidateId, params.candidateId),
          eq(candidateIdentity.kind, s.kind),
          eq(candidateIdentity.valueNormalized, s.valueNormalized),
        )
    const existing = await db.select({ id: candidateIdentity.id }).from(candidateIdentity).where(where).limit(1)
    if (existing.length > 0) {
      await db.update(candidateIdentity)
        .set({ lastSeenAt: now })
        .where(eq(candidateIdentity.id, existing[0]!.id))
      updated += 1
    }
    else {
      await db.insert(candidateIdentity).values({
        candidateId: params.candidateId,
        organizationId: params.organizationId,
        groupId: params.groupId,
        kind: s.kind,
        valueRaw: s.valueRaw,
        valueNormalized: s.valueNormalized,
        confidence: s.confidence,
        source: s.source,
        firstSeenAt: now,
        lastSeenAt: now,
      })
      inserted += 1
    }
  }
  return { inserted, updated }
}

/**
 * In-memory кеш organization_id → group_id с TTL.
 * group_id меняется крайне редко (реорганизация холдинга), а читается на каждый dedup-запрос.
 * Сами значения и null-ы кешируем одинаково (чтобы не бить в БД для orgs без группы).
 */
const GROUP_ID_CACHE = new Map<string, { value: string | null; expiresAt: number }>()
const GROUP_ID_TTL_MS = 5 * 60 * 1000 // 5 минут

/** Сброс кеша group_id — вызывать при изменении связи organization → group. */
export function invalidateOrgGroupCache(organizationId?: string) {
  if (organizationId) GROUP_ID_CACHE.delete(organizationId)
  else GROUP_ID_CACHE.clear()
}

/**
 * По organizationId возвращает group_id (или null, если org ещё не в группе).
 * Использует типизированный organizationExt (объявлен в schema/app.ts) — без raw SQL.
 * Результат кешируется на 5 минут.
 */
export async function getOrgGroupId(organizationId: string): Promise<string | null> {
  const cached = GROUP_ID_CACHE.get(organizationId)
  const now = Date.now()
  if (cached && cached.expiresAt > now) {
    return cached.value
  }
  const rows = await db
    .select({ groupId: organizationExt.groupId })
    .from(organizationExt)
    .where(eq(organizationExt.id, organizationId))
    .limit(1)
  const value = rows[0]?.groupId ?? null
  GROUP_ID_CACHE.set(organizationId, { value, expiresAt: now + GROUP_ID_TTL_MS })
  return value
}
