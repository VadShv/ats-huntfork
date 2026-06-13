/**
 * POST /api/extension/check
 *
 * Проверяет, есть ли уже в базе кандидаты по списку hh resume URL'ов
 * (или просто resumeId хешей). Используется для:
 *   • подсветки одной плашки на странице резюме (1 элемент)
 *   • подсветки результатов поиска hh.ru (batch до 50)
 *
 * Body:
 *   { resumeIds: string[] }  — массив hh resume hash'ей (без URL)
 * ИЛИ
 *   { urls: string[] }       — массив URL'ов вида https://hh.ru/resume/<hash>
 *
 * Ответ:
 *   { results: Array<{
 *       resumeId: string,
 *       exists: boolean,
 *       candidateId?: string,
 *       candidateName?: string,
 *       addedAt?: string,
 *       applications?: Array<{ jobId, jobTitle, status, currentStageName }>
 *     }>
 *   }
 */
import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { application, candidate, job, pipelineStage } from '../../database/schema'

const bodySchema = z.object({
  resumeIds: z.array(z.string().min(8).max(128)).optional(),
  urls: z.array(z.string().url()).optional(),
}).refine(
  (v) => (v.resumeIds && v.resumeIds.length > 0) || (v.urls && v.urls.length > 0),
  { message: 'Нужен resumeIds[] или urls[]' },
)

/** Извлекает hh resume hash из URL `https://hh.ru/resume/<hash>`. */
function extractResumeId(url: string): string | null {
  const m = url.match(/\/resume\/([a-f0-9]+)/i)
  return m?.[1] ?? null
}

export default defineEventHandler(async (event) => {
  // candidate:read достаточно — это read-only
  const session = await requirePermission(event, { candidate: ['read'] })
  const orgId = session.session.activeOrganizationId
  const body = await readValidatedBody(event, bodySchema.parse)

  const resumeIds = new Set<string>(body.resumeIds ?? [])
  for (const url of body.urls ?? []) {
    const rid = extractResumeId(url)
    if (rid) resumeIds.add(rid)
  }

  if (resumeIds.size === 0) {
    return { results: [] }
  }
  if (resumeIds.size > 100) {
    throw createError({ statusCode: 400, statusMessage: 'Слишком много id за раз (макс 100)' })
  }

  const idList = Array.from(resumeIds)

  // Ищем кандидатов в этой org с такими hh_resume_id
  const candidates = await db
    .select({
      id: candidate.id,
      firstName: candidate.firstName,
      lastName: candidate.lastName,
      hhResumeId: candidate.hhResumeId,
      addedAt: candidate.createdAt,
    })
    .from(candidate)
    .where(and(
      eq(candidate.organizationId, orgId),
      eq(candidate.mergeStatus, 'active'),
      inArray(candidate.hhResumeId, idList),
    ))

  // Список заявок этих кандидатов (с названием вакансии и стадией)
  const apps = candidates.length > 0
    ? await db
      .select({
        candidateId: application.candidateId,
        jobId: application.jobId,
        jobTitle: job.title,
        status: application.status,
        currentStageId: application.currentStageId,
        stageName: pipelineStage.name,
      })
      .from(application)
      .innerJoin(job, eq(job.id, application.jobId))
      .leftJoin(pipelineStage, eq(pipelineStage.id, application.currentStageId))
      .where(and(
        eq(application.organizationId, orgId),
        inArray(application.candidateId, candidates.map(c => c.id)),
      ))
    : []

  const appsByCand = new Map<string, typeof apps>()
  for (const a of apps) {
    const list = appsByCand.get(a.candidateId) ?? []
    list.push(a)
    appsByCand.set(a.candidateId, list)
  }

  const candByResume = new Map(candidates.map(c => [c.hhResumeId!, c]))

  const results = idList.map((rid) => {
    const cand = candByResume.get(rid)
    if (!cand) {
      return { resumeId: rid, exists: false as const }
    }
    return {
      resumeId: rid,
      exists: true as const,
      candidateId: cand.id,
      candidateName: `${cand.lastName} ${cand.firstName}`.trim(),
      addedAt: cand.addedAt.toISOString(),
      applications: (appsByCand.get(cand.id) ?? []).map(a => ({
        jobId: a.jobId,
        jobTitle: a.jobTitle,
        status: a.status,
        currentStageName: a.stageName ?? null,
      })),
    }
  })

  return { results }
})
