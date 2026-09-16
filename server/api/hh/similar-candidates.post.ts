/**
 * POST /api/hh/similar-candidates
 *
 * По вакансии (с брифом hardMustHave / niceToHave) ищет кандидатов в базе
 * организации, чьи навыки (hhResumeRaw.skill_set) пересекаются с требованиями.
 * matchPercent = round(overlap / jobSkills.length * 100).
 *
 * Тело: { jobId: string }
 * Ответ: { items: HhSimilarCandidate[] }
 */
import { and, eq, isNotNull } from 'drizzle-orm'
import { candidate, job, jobBrief } from '../../database/schema'

export interface HhSimilarCandidate {
  candidateId: string
  firstName: string
  lastName: string
  matchPercent: number
  overlappingSkills: string[]
  hhResumeId: string | null
}

const LIMIT = 20

export default defineEventHandler(async (event) => {
  const { session } = await requirePermission(event, { hhSimilarVacancy: ['read'] })
  const orgId = session.activeOrganizationId

  const body = await readBody<{ jobId?: string }>(event)
  const jobId = body?.jobId
  if (!jobId) {
    throw createError({ statusCode: 400, statusMessage: 'Не указан jobId' })
  }

  const jobRow = await db
    .select({ id: job.id, title: job.title })
    .from(job)
    .where(and(eq(job.id, jobId), eq(job.organizationId, orgId)))
    .limit(1)

  if (!jobRow[0]) {
    throw createError({ statusCode: 404, statusMessage: 'Вакансия не найдена' })
  }

  const brief = await db
    .select({
      hardMustHave: jobBrief.hardMustHave,
      niceToHave: jobBrief.niceToHave,
    })
    .from(jobBrief)
    .where(eq(jobBrief.jobId, jobId))
    .limit(1)

  const hardSkills = brief[0]?.hardMustHave ?? []
  const niceSkills = brief[0]?.niceToHave ?? []
  const jobSkills = [...hardSkills, ...niceSkills]

  if (jobSkills.length === 0) {
    return { items: [] }
  }

  const candidates = await db
    .select({
      id: candidate.id,
      firstName: candidate.firstName,
      lastName: candidate.lastName,
      hhResumeId: candidate.hhResumeId,
      hhResumeRaw: candidate.hhResumeRaw,
    })
    .from(candidate)
    .where(and(
      eq(candidate.organizationId, orgId),
      eq(candidate.mergeStatus, 'active'),
      isNotNull(candidate.hhResumeRaw),
    ))
    .limit(200)

  const jobSkillsLower = new Set(jobSkills.map((s) => s.toLowerCase().trim()))

  const results: HhSimilarCandidate[] = []
  for (const c of candidates) {
    const raw = c.hhResumeRaw as Record<string, unknown> | null
    if (!raw || !Array.isArray(raw.skill_set)) continue
    const candSkills = (raw.skill_set as string[]).map((s) => s.toLowerCase().trim())
    const overlapping = [...new Set(candSkills.filter((s) => jobSkillsLower.has(s)))]
    if (overlapping.length === 0) continue
    const matchPercent = Math.round((overlapping.length / jobSkillsLower.size) * 100)
    results.push({
      candidateId: c.id,
      firstName: c.firstName,
      lastName: c.lastName,
      matchPercent,
      overlappingSkills: overlapping,
      hhResumeId: c.hhResumeId,
    })
  }

  results.sort((a, b) => b.matchPercent - a.matchPercent)

  return { items: results.slice(0, LIMIT) }
})
