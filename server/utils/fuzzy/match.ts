import { and, eq, ne, sql } from 'drizzle-orm'
import { candidate, candidateDuplicateCandidate } from '../../database/schema'
import { getOrgGroupId } from '../dedup/resolve'
import { citySimilarity, dobSimilarity, nameSimilarity } from './normalize'

/** Минимальный порог итогового скора, при котором пара попадает в очередь на ревью. */
export const FUZZY_REVIEW_THRESHOLD = 85

/** Порог «рекомендации к слиянию» (помечается отдельно в баннере, но не авто-сливается). */
export const FUZZY_AUTOMERGE_THRESHOLD = 95

/**
 * Веса факторов в финальном скоре (сумма = 100).
 *   ФИО: 55  — основной признак
 *   Город: 20
 *   ДР: 25  — сильный, бинарный
 *   (Должность пока не используем — слабо различима)
 */
const WEIGHTS = {
  name: 55,
  city: 20,
  dob: 25,
} as const

export interface FuzzyMatchSignals {
  name: number
  city: number
  dob: number
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
    return { score: 0, signals: { name: nameScore, city: 0, dob: 0 } }
  }

  const cityScore = citySimilarity(a.city, b.city)
  const dobScore = dobSimilarity(a.dateOfBirth, b.dateOfBirth)

  const weighted = (
    nameScore * WEIGHTS.name
    + cityScore * WEIGHTS.city
    + dobScore * WEIGHTS.dob
  ) / 100

  return {
    score: Math.round(weighted),
    signals: { name: nameScore, city: cityScore, dob: dobScore },
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
      hhResumeRaw: candidate.hhResumeRaw,
    })
    .from(candidate)
    .where(eq(candidate.id, candidateId))
    .limit(1)

  if (!target || !target.lastName) return []

  const targetCity = extractCityFromHhRaw(target.hhResumeRaw)
  const lastNamePrefix = target.lastName.toLowerCase().slice(0, 2)

  const groupId = options.includeOtherOrgs
    ? await getOrgGroupId(target.organizationId)
    : null

  let rows: Array<{
    id: string
    first_name: string | null
    last_name: string | null
    date_of_birth: string | null
    hh_resume_raw: unknown
  }> = []

  if (groupId) {
    const res = await db.execute<{
      id: string
      first_name: string | null
      last_name: string | null
      date_of_birth: string | null
      hh_resume_raw: unknown
    }>(sql`
      SELECT c.id, c.first_name, c.last_name, c.date_of_birth, c.hh_resume_raw
      FROM candidate c
      INNER JOIN organization o ON o.id = c.organization_id
      WHERE o.group_id = ${groupId}
        AND c.id != ${candidateId}
        AND c.merge_status = 'active'
        AND lower(c.last_name) LIKE ${lastNamePrefix + '%'}
    `)
    rows = Array.isArray(res) ? (res as any) : ((res as any).rows ?? [])
  }
  else {
    const res = await db
      .select({
        id: candidate.id,
        first_name: candidate.firstName,
        last_name: candidate.lastName,
        date_of_birth: candidate.dateOfBirth,
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

  const results: FuzzyMatchResult[] = []
  for (const c of rows) {
    const cCity = extractCityFromHhRaw(c.hh_resume_raw)
    const { score, signals } = computePairScore(
      {
        firstName: target.firstName,
        lastName: target.lastName,
        city: targetCity,
        dateOfBirth: target.dateOfBirth,
      },
      {
        firstName: c.first_name,
        lastName: c.last_name,
        city: cCity,
        dateOfBirth: c.date_of_birth,
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
