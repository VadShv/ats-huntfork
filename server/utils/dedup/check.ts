import { and, eq, inArray, or, sql } from 'drizzle-orm'
import { candidate, candidateIdentity, organizationExt } from '../../database/schema'
import { computePairScore, FUZZY_REVIEW_THRESHOLD } from '../fuzzy/match'
import { normalizeEmail, normalizePhone } from './normalize'
import { getOrgGroupId } from './resolve'

/**
 * Сырые данные кандидата с формы (`/dashboard/candidates/new`).
 * Город пока не приходит из формы — оставлен на будущее (например, после ресюме-парсера).
 */
export interface DraftCandidateInput {
  firstName?: string | null
  lastName?: string | null
  email?: string | null
  phone?: string | null
  dateOfBirth?: string | null
  city?: string | null
}

export interface ExactDuplicateMatch {
  /** Какой сигнал сработал — кандидат с таким же email или phone. */
  kind: 'email' | 'phone'
  /** Нормализованное значение, по которому матч. */
  valueNormalized: string
  /** id уже существующего кандидата. */
  candidateId: string
  /** organization_id кандидата (важно для отображения «другой клиент»). */
  organizationId: string
  /** Имя для отображения. */
  firstName: string | null
  lastName: string | null
  email: string | null
  phone: string | null
  /** True — кандидат в другой организации той же группы (cross-org match). */
  crossOrg: boolean
}

export interface FuzzyDuplicateMatch {
  candidateId: string
  organizationId: string
  firstName: string | null
  lastName: string | null
  email: string | null
  phone: string | null
  dateOfBirth: string | null
  score: number
  signals: { name: number; city: number; dob: number }
  crossOrg: boolean
}

export interface DraftDuplicatesResult {
  /** Точные совпадения по email или phone — это «жёсткие» дубли, блокируем. */
  exact: ExactDuplicateMatch[]
  /** Fuzzy-совпадения по ФИО+ДР+город со score ≥ threshold (по умолчанию 85). */
  fuzzy: FuzzyDuplicateMatch[]
}

function extractCityFromHhRaw(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null
  const area = (raw as Record<string, unknown>).area
  if (!area || typeof area !== 'object') return null
  const name = (area as Record<string, unknown>).name
  return typeof name === 'string' ? name : null
}

/**
 * Ищет дубликаты для черновика кандидата (форма /candidates/new или live-проверка).
 *
 * Логика:
 *   1. Нормализуем email и phone — это «жёсткие» сигналы. Ищем точные совпадения
 *      по candidate_identity в рамках группы (или fallback в рамках org, если group_id отсутствует).
 *   2. Fuzzy: pre-filter по первым 2 буквам фамилии, считаем взвешенный скор по ФИО+ДР+city.
 *      Возвращаем все совпадения со score ≥ threshold.
 *
 * Кандидаты в статусе `merged` исключаются (показывать их бессмысленно — есть primary).
 */
export async function findDuplicatesForDraft(
  organizationId: string,
  input: DraftCandidateInput,
  options: { threshold?: number } = {},
): Promise<DraftDuplicatesResult> {
  const threshold = options.threshold ?? FUZZY_REVIEW_THRESHOLD
  const groupId = await getOrgGroupId(organizationId)

  // ── 1. Exact matches: email и phone через candidate_identity
  const exactSignals: Array<{ kind: 'email' | 'phone'; valueNormalized: string }> = []
  const emailNorm = normalizeEmail(input.email)
  if (emailNorm) exactSignals.push({ kind: 'email', valueNormalized: emailNorm })
  const phoneNorm = normalizePhone(input.phone)
  if (phoneNorm) exactSignals.push({ kind: 'phone', valueNormalized: phoneNorm })

  const exact: ExactDuplicateMatch[] = []
  if (exactSignals.length > 0) {
    // Поиск по candidate_identity (там лежат email/phone всех кандидатов).
    // Если groupId есть — ищем кросс-org по группе; иначе fallback на org.
    const ors = exactSignals.map(s =>
      and(eq(candidateIdentity.kind, s.kind), eq(candidateIdentity.valueNormalized, s.valueNormalized)),
    )
    const baseWhere = groupId
      ? and(eq(candidateIdentity.groupId, groupId), or(...ors))
      : and(eq(candidateIdentity.organizationId, organizationId), or(...ors))

    const identityRows = await db
      .select({
        candidateId: candidateIdentity.candidateId,
        kind: candidateIdentity.kind,
        valueNormalized: candidateIdentity.valueNormalized,
      })
      .from(candidateIdentity)
      .where(baseWhere)

    if (identityRows.length > 0) {
      const candIds = Array.from(new Set(identityRows.map(r => r.candidateId)))
      const cands = await db
        .select({
          id: candidate.id,
          organizationId: candidate.organizationId,
          firstName: candidate.firstName,
          lastName: candidate.lastName,
          email: candidate.email,
          phone: candidate.phone,
          mergeStatus: candidate.mergeStatus,
          mergedIntoId: candidate.mergedIntoId,
        })
        .from(candidate)
        .where(inArray(candidate.id, candIds))

      // Применяем редирект merged → primary, и исключаем сам merged.
      const candMap = new Map(cands.map(c => [c.id, c]))
      const seen = new Set<string>() // dedup по primary candidate id + kind

      for (const r of identityRows) {
        const c = candMap.get(r.candidateId)
        if (!c) continue
        // Если merged — переключаемся на primary
        const primaryId = c.mergeStatus === 'merged' && c.mergedIntoId ? c.mergedIntoId : c.id
        const primary = primaryId === c.id ? c : candMap.get(primaryId)
        // Primary может не входить в начальный candIds — догружаем
        let resolved = primary
        if (!resolved) {
          const [extra] = await db
            .select({
              id: candidate.id,
              organizationId: candidate.organizationId,
              firstName: candidate.firstName,
              lastName: candidate.lastName,
              email: candidate.email,
              phone: candidate.phone,
              mergeStatus: candidate.mergeStatus,
              mergedIntoId: candidate.mergedIntoId,
            })
            .from(candidate)
            .where(eq(candidate.id, primaryId))
            .limit(1)
          resolved = extra
        }
        if (!resolved) continue
        if (resolved.mergeStatus === 'merged') continue // primary тоже merged — пропускаем

        const dedupKey = `${resolved.id}:${r.kind}`
        if (seen.has(dedupKey)) continue
        seen.add(dedupKey)

        exact.push({
          kind: r.kind as 'email' | 'phone',
          valueNormalized: r.valueNormalized,
          candidateId: resolved.id,
          organizationId: resolved.organizationId,
          firstName: resolved.firstName,
          lastName: resolved.lastName,
          email: resolved.email,
          phone: resolved.phone,
          crossOrg: resolved.organizationId !== organizationId,
        })
      }
    }
  }

  // ── 2. Fuzzy matches: по ФИО+ДР+city
  const fuzzy: FuzzyDuplicateMatch[] = []
  const lastName = input.lastName?.trim()
  if (lastName && lastName.length >= 2) {
    const lastNamePrefix = lastName.toLowerCase().slice(0, 2)
    // Грубый pre-filter — берём кандидатов с похожим началом фамилии, активных, в группе/org
    let rows: Array<{
      id: string
      organization_id: string
      first_name: string | null
      last_name: string | null
      email: string | null
      phone: string | null
      date_of_birth: string | null
      hh_resume_raw: unknown
    }> = []

    if (groupId) {
      // Типизированный JOIN через organizationExt — без raw SQL
      const res = await db
        .select({
          id: candidate.id,
          organization_id: candidate.organizationId,
          first_name: candidate.firstName,
          last_name: candidate.lastName,
          email: candidate.email,
          phone: candidate.phone,
          date_of_birth: candidate.dateOfBirth,
          hh_resume_raw: candidate.hhResumeRaw,
        })
        .from(candidate)
        .innerJoin(organizationExt, eq(organizationExt.id, candidate.organizationId))
        .where(and(
          eq(organizationExt.groupId, groupId),
          eq(candidate.mergeStatus, 'active'),
          sql`lower(${candidate.lastName}) LIKE ${lastNamePrefix + '%'}`,
        ))
      rows = res as any
    }
    else {
      const res = await db
        .select({
          id: candidate.id,
          organization_id: candidate.organizationId,
          first_name: candidate.firstName,
          last_name: candidate.lastName,
          email: candidate.email,
          phone: candidate.phone,
          date_of_birth: candidate.dateOfBirth,
          hh_resume_raw: candidate.hhResumeRaw,
        })
        .from(candidate)
        .where(and(
          eq(candidate.organizationId, organizationId),
          eq(candidate.mergeStatus, 'active'),
          sql`lower(${candidate.lastName}) LIKE ${lastNamePrefix + '%'}`,
        ))
      rows = res as any
    }

    const exactCandidateIds = new Set(exact.map(e => e.candidateId))

    for (const c of rows) {
      // Пропускаем уже найденных через exact — карточка дубля одна на двоих
      if (exactCandidateIds.has(c.id)) continue

      const cCity = extractCityFromHhRaw(c.hh_resume_raw)
      const { score, signals } = computePairScore(
        {
          firstName: input.firstName ?? null,
          lastName: input.lastName ?? null,
          city: input.city ?? null,
          dateOfBirth: input.dateOfBirth ?? null,
        },
        {
          firstName: c.first_name,
          lastName: c.last_name,
          city: cCity,
          dateOfBirth: c.date_of_birth,
        },
      )
      if (score >= threshold) {
        fuzzy.push({
          candidateId: c.id,
          organizationId: c.organization_id,
          firstName: c.first_name,
          lastName: c.last_name,
          email: c.email,
          phone: c.phone,
          dateOfBirth: c.date_of_birth,
          score,
          signals,
          crossOrg: c.organization_id !== organizationId,
        })
      }
    }

    fuzzy.sort((a, b) => b.score - a.score)
  }

  return { exact, fuzzy }
}

