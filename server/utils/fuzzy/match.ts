import { and, eq, ne, sql } from 'drizzle-orm'
import { candidate, candidateDuplicateCandidate, organizationExt } from '../../database/schema'
import { getOrgGroupId } from '../dedup/resolve'
import { citySimilarity, dobSimilarity, nameSimilarity, orgListSimilarity } from './normalize'

/** Минимальный порог итогового скора, при котором пара попадает в очередь на ревью. */
export const FUZZY_REVIEW_THRESHOLD = 85

/** Порог «рекомендации к слиянию» (помечается отдельно в баннере, но не авто-сливается). */
export const FUZZY_AUTOMERGE_THRESHOLD = 95

/**
 * Веса факторов в финальном скоре (сумма = 100).
 *
 * Sprint 3.2 (P2.1): добавлен 4-й сигнал — employer/education.
 *   ФИО: 50  — основной признак
 *   Город: 15
 *   ДР: 20  — сильный, бинарный
 *   Работодатель+Образование: 15  — дополнительный сигнал
 */
const WEIGHTS = {
  name: 50,
  city: 15,
  dob: 20,
  employer: 15,
} as const

export interface FuzzyMatchSignals {
  name: number
  city: number
  dob: number
  /** Sprint 3.2: лучшая пара из работодателей/учебных заведений */
  employer: number
}

export interface FuzzyMatchResult {
  candidateId: string
  score: number
  signals: FuzzyMatchSignals
}

/** Кандидатные данные для сравнения (минимально-необходимое подмножество). */
export interface FuzzyCandidateInput {
  firstName: string | null
  lastName: string | null
  city: string | null
  dateOfBirth: string | null
  /** Sprint 3.2: список работодателей и учебных заведений (из hh_resume_raw). */
  organizations?: Array<string | null | undefined> | null
}

/**
 * Считает взвешенный скор пары кандидатов 0..100.
 * Если ФИО не совпадает хотя бы на 60 — итог 0 (ФИО — обязательный сигнал).
 */
export function computePairScore(
  a: FuzzyCandidateInput,
  b: FuzzyCandidateInput,
): { score: number; signals: FuzzyMatchSignals } {
  const fullA = [a.lastName, a.firstName].filter(Boolean).join(' ')
  const fullB = [b.lastName, b.firstName].filter(Boolean).join(' ')

  const nameScore = nameSimilarity(fullA, fullB)
  if (nameScore < 60) {
    return { score: 0, signals: { name: nameScore, city: 0, dob: 0, employer: 0 } }
  }

  const cityScore = citySimilarity(a.city, b.city)
  const dobScore = dobSimilarity(a.dateOfBirth, b.dateOfBirth)
  const employerScore = orgListSimilarity(a.organizations ?? null, b.organizations ?? null)

  // Sprint 3.2: если employer-сигнал НЕДОСТУПЕН (у обоих organizations пусто или не указано) —
  // перераспределяем вес пропорционально на остальные сигналы, чтобы совпадающие без employer оставались 100.
  const hasEmployerData = (a.organizations && a.organizations.length > 0) && (b.organizations && b.organizations.length > 0)
  const totalWeight = hasEmployerData
    ? WEIGHTS.name + WEIGHTS.city + WEIGHTS.dob + WEIGHTS.employer
    : WEIGHTS.name + WEIGHTS.city + WEIGHTS.dob

  const weighted = (
    nameScore * WEIGHTS.name
    + cityScore * WEIGHTS.city
    + dobScore * WEIGHTS.dob
    + (hasEmployerData ? employerScore * WEIGHTS.employer : 0)
  ) / totalWeight

  return {
    score: Math.round(weighted),
    signals: { name: nameScore, city: cityScore, dob: dobScore, employer: employerScore },
  }
}

/**
 * Извлекает «город» кандидата из hh_resume_raw.area.name (jsonb).
 * В candidate отдельной колонки city нет — это поле приходит с hh.ru.
 */
function extractCityFromHhRaw(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null
  const area = (raw as Record<string, unknown>).area
  if (!area || typeof area !== 'object') return null
  const name = (area as Record<string, unknown>).name
  return typeof name === 'string' ? name : null
}

/**
 * Sprint 3.2 (P2.1): извлекает список работодателей и учебных заведений из hh_resume_raw.
 * Структура hh:
 *   experience: [{ company, position, ... }]
 *   education.primary: [{ name, organization, year }]
 */
function extractOrgsFromHhRaw(raw: unknown): string[] {
  if (!raw || typeof raw !== 'object') return []
  const out: string[] = []
  const r = raw as Record<string, unknown>

  // experience[].company
  const exp = r.experience
  if (Array.isArray(exp)) {
    for (const e of exp) {
      if (e && typeof e === 'object') {
        const c = (e as Record<string, unknown>).company
        if (typeof c === 'string' && c.trim()) out.push(c)
      }
    }
  }

  // education.primary[].name (НАЗВАНИЕ вуза)
  const edu = r.education
  if (edu && typeof edu === 'object') {
    const primary = (edu as Record<string, unknown>).primary
    if (Array.isArray(primary)) {
      for (const p of primary) {
        if (p && typeof p === 'object') {
          const n = (p as Record<string, unknown>).name
          if (typeof n === 'string' && n.trim()) out.push(n)
        }
      }
    }
  }

  return out
}

/**
 * Ищет в группе всех кандидатов, которые могут быть fuzzy-дублями для candidateId.
 * Возвращает только результаты со score >= threshold (по умолчанию FUZZY_REVIEW_THRESHOLD).
 *
 * Чтобы не делать N×N полное сравнение, делаем грубый pre-filter в SQL:
 *   • та же organization (или группа, если includeOtherOrgs)
 *   • merge_status = 'active'
 *   • первые буквы фамилии совпадают (LEFT(lower(last_name), 2))
 *   • НЕ сам кандидат
 */
export async function findFuzzyDuplicatesForCandidate(
  candidateId: string,
  options: { threshold?: number; includeOtherOrgs?: boolean } = {},
): Promise<FuzzyMatchResult[]> {
  const threshold = options.threshold ?? FUZZY_REVIEW_THRESHOLD

  const [target] = await db
    .select({
      id: candidate.id,
      organizationId: candidate.organizationId,
      firstName: candidate.firstName,
      lastName: candidate.lastName,
      dateOfBirth: candidate.dateOfBirth,
      city: candidate.city,
      hhResumeRaw: candidate.hhResumeRaw,
    })
    .from(candidate)
    .where(eq(candidate.id, candidateId))
    .limit(1)

  if (!target || !target.lastName) return []

  // Sprint 3.3: явный candidate.city имеет приоритет над hh_resume_raw.area.name
  const targetCity = target.city ?? extractCityFromHhRaw(target.hhResumeRaw)
  const lastNamePrefix = target.lastName.toLowerCase().slice(0, 2)

  const groupId = options.includeOtherOrgs
    ? await getOrgGroupId(target.organizationId)
    : null

  let rows: Array<{
    id: string
    first_name: string | null
    last_name: string | null
    date_of_birth: string | null
    city: string | null
    hh_resume_raw: unknown
  }> = []

  if (groupId) {
    // Кросс-орг поиск по group_id через типизированный JOIN с organizationExt
    // (organizationExt — наша Drizzle-проекция таблицы organization, см. schema/app.ts)
    const res = await db
      .select({
        id: candidate.id,
        first_name: candidate.firstName,
        last_name: candidate.lastName,
        date_of_birth: candidate.dateOfBirth,
        city: candidate.city,
        hh_resume_raw: candidate.hhResumeRaw,
      })
      .from(candidate)
      .innerJoin(organizationExt, eq(organizationExt.id, candidate.organizationId))
      .where(and(
        eq(organizationExt.groupId, groupId),
        ne(candidate.id, candidateId),
        eq(candidate.mergeStatus, 'active'),
        sql`lower(${candidate.lastName}) LIKE ${lastNamePrefix + '%'}`,
      ))
    rows = res as any
  }
  else {
    const res = await db
      .select({
        id: candidate.id,
        first_name: candidate.firstName,
        last_name: candidate.lastName,
        date_of_birth: candidate.dateOfBirth,
        city: candidate.city,
        hh_resume_raw: candidate.hhResumeRaw,
      })
      .from(candidate)
      .where(and(
        eq(candidate.organizationId, target.organizationId),
        ne(candidate.id, candidateId),
        eq(candidate.mergeStatus, 'active'),
        sql`lower(${candidate.lastName}) LIKE ${lastNamePrefix + '%'}`,
      ))
    rows = res as any
  }

  const targetOrgs = extractOrgsFromHhRaw(target.hhResumeRaw)

  const results: FuzzyMatchResult[] = []
  for (const c of rows) {
    // Sprint 3.3: явный city приоритетнее извлечённого из hh
    const cCity = c.city ?? extractCityFromHhRaw(c.hh_resume_raw)
    const cOrgs = extractOrgsFromHhRaw(c.hh_resume_raw)
    const { score, signals } = computePairScore(
      {
        firstName: target.firstName,
        lastName: target.lastName,
        city: targetCity,
        dateOfBirth: target.dateOfBirth,
        organizations: targetOrgs,
      },
      {
        firstName: c.first_name,
        lastName: c.last_name,
        city: cCity,
        dateOfBirth: c.date_of_birth,
        organizations: cOrgs,
      },
    )
    if (score >= threshold) {
      results.push({ candidateId: c.id, score, signals })
    }
  }
  return results.sort((a, b) => b.score - a.score)
}

/**
 * Идемпотентно записывает пару в candidate_duplicate_candidate.
 * Канонизирует порядок (a < b), обновляет score/signals если запись уже есть и статус pending.
 */
export async function upsertDuplicateCandidate(input: {
  organizationId: string
  candidateIdA: string
  candidateIdB: string
  score: number
  signals: FuzzyMatchSignals
}): Promise<{ id: string; isNew: boolean }> {
  const [a, b] = input.candidateIdA < input.candidateIdB
    ? [input.candidateIdA, input.candidateIdB]
    : [input.candidateIdB, input.candidateIdA]

  const groupId = await getOrgGroupId(input.organizationId)

  const existing = await db
    .select({ id: candidateDuplicateCandidate.id, status: candidateDuplicateCandidate.status })
    .from(candidateDuplicateCandidate)
    .where(and(
      eq(candidateDuplicateCandidate.candidateIdA, a),
      eq(candidateDuplicateCandidate.candidateIdB, b),
    ))
    .limit(1)

  if (existing.length > 0) {
    const row = existing[0]!
    if (row.status === 'pending') {
      await db
        .update(candidateDuplicateCandidate)
        .set({
          score: input.score,
          signals: input.signals as unknown as Record<string, number>,
          updatedAt: new Date(),
        })
        .where(eq(candidateDuplicateCandidate.id, row.id))
    }
    return { id: row.id, isNew: false }
  }

  const [inserted] = await db
    .insert(candidateDuplicateCandidate)
    .values({
      groupId: groupId ?? undefined,
      candidateIdA: a,
      candidateIdB: b,
      score: input.score,
      signals: input.signals as unknown as Record<string, number>,
      status: 'pending',
    })
    .returning({ id: candidateDuplicateCandidate.id })

  return { id: inserted!.id, isNew: true }
}
