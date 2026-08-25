import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { application, candidate, job, pipelineStage } from '../../../database/schema/app'
import { hmDecision } from '../../../database/schema/hm'
import { requireHm } from '../../../utils/requireHm'
import { isHiringManagerOnJob } from '../../../utils/hiringManager'
import { resolveHmReviewStage } from '../../../utils/hm-stage-resolver'

const paramsSchema = z.object({
  id: z.string().min(1).max(64),
})

/**
 * GET /api/hm/applications/[id]
 *
 * Read-only карточка кандидата для НМ.
 * Возвращает только то, что НМ разрешено видеть по ТЗ v1.1:
 *   - Кандидат (ФИО, город, коротко резюме через AI-summary или hh raw).
 *   - Заявка (текущий этап, дата создания).
 *   - Вакансия (заголовок, локация).
 *   - Зарплатные ожидания — только если member.hm_can_view_salary=true.
 *   - Существующее эффективное решение НМ (для UI кнопок «отменить/уже решено»).
 *
 * НЕ возвращает: внутренние комментарии (is_internal), скоринг, аудит, PII не относящуюся к делу.
 */
export default defineEventHandler(async (event) => {
  const session = await requireHm(event)
  const orgId = session.session.activeOrganizationId

  const { id: applicationId } = await getValidatedRouterParams(event, paramsSchema.parse)

  // 1. Загружаем заявку + связи
  const [row] = await db
    .select({
      appId: application.id,
      appStatus: application.status,
      appCreatedAt: application.createdAt,
      appNotes: application.notes,
      currentStageId: application.currentStageId,
      stageChangedAt: application.stageChangedAt,

      candidateId: candidate.id,
      firstName: candidate.firstName,
      lastName: candidate.lastName,
      displayName: candidate.displayName,
      city: candidate.city,
      aiSummary: candidate.aiSummary,
      hhResumeRaw: candidate.hhResumeRaw,

      jobId: job.id,
      jobTitle: job.title,
      jobLocation: job.location,
      jobPipelineId: job.pipelineId,

      stageName: pipelineStage.name,
      stageType: pipelineStage.type,
    })
    .from(application)
    .innerJoin(candidate, eq(candidate.id, application.candidateId))
    .innerJoin(job, eq(job.id, application.jobId))
    .leftJoin(pipelineStage, eq(pipelineStage.id, application.currentStageId))
    .where(and(
      eq(application.id, applicationId),
      eq(application.organizationId, orgId),
    ))
    .limit(1)

  if (!row) {
    throw createError({ statusCode: 404, statusMessage: 'Отклик не найден' })
  }

  // 2. НМ должен быть назначен на эту вакансию
  const isAssigned = await isHiringManagerOnJob(orgId, session.user.id, row.jobId)
  if (!isAssigned) {
    throw createError({ statusCode: 403, statusMessage: 'Нет доступа к этой вакансии' })
  }

  // 3. Существующее эффективное решение НМ (любого — не только текущего)
  const [effective] = await db
    .select({
      id: hmDecision.id,
      decision: hmDecision.decision,
      hmUserId: hmDecision.hmUserId,
      decidedAt: hmDecision.decidedAt,
      comment: hmDecision.comment,
    })
    .from(hmDecision)
    .where(and(
      eq(hmDecision.applicationId, applicationId),
      eq(hmDecision.isEffective, true),
    ))
    .limit(1)

  // 4. Строим безопасный вариант резюме из hh_resume_raw для НМ.
  //   Не включаем: телефон, email, соцсети, дату рождения, PII
  //   (их видит только рекрутёр).  Зарплата — только при hm_can_view_salary=true.
  let expectedSalary: { amount?: number; currency?: string } | null = null
  let resumeSnapshot: {
    title?: string
    about?: string
    totalExperienceMonths?: number
    area?: string
    skills?: string[]
    keySkills?: string[]
    languages?: Array<{ name?: string; level?: string }>
    experiences?: Array<{
      company?: string
      position?: string
      description?: string
      start?: string
      end?: string
    }>
    education?: Array<{
      name?: string
      organization?: string
      result?: string
      year?: number
    }>
    professionalRoles?: string[]
    employments?: string[]
    schedules?: string[]
    updatedAt?: string
  } | null = null

  if (row.hhResumeRaw && typeof row.hhResumeRaw === 'object') {
    const raw = row.hhResumeRaw as any

    if (session.hm.canViewSalary && raw?.salary && (raw.salary.amount || raw.salary.value)) {
      expectedSalary = {
        amount: raw.salary.amount ?? raw.salary.value,
        currency: raw.salary.currency,
      }
    }

    // Строки ограничиваем чтобы не раздувать ответ; HTML/markup чистим.
    const stripHtml = (s: unknown): string | undefined => {
      if (typeof s !== 'string') return undefined
      const clean = s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      return clean || undefined
    }

    const experiences: Array<any> = Array.isArray(raw?.experience) ? raw.experience : []
    const education: Array<any> = Array.isArray(raw?.education?.primary) ? raw.education.primary
      : (Array.isArray(raw?.education) ? raw.education : [])

    resumeSnapshot = {
      title: stripHtml(raw?.title),
      about: stripHtml(raw?.skills), // hh.ru: «skills» — это свободный текст «О себе»
      totalExperienceMonths: typeof raw?.total_experience?.months === 'number' ? raw.total_experience.months : undefined,
      area: typeof raw?.area?.name === 'string' ? raw.area.name : undefined,
      keySkills: Array.isArray(raw?.skill_set) ? raw.skill_set.slice(0, 40).map(String) : undefined,
      languages: Array.isArray(raw?.language)
        ? raw.language.slice(0, 20).map((l: any) => ({
            name: typeof l?.name === 'string' ? l.name : undefined,
            level: typeof l?.level?.name === 'string' ? l.level.name : undefined,
          }))
        : undefined,
      experiences: experiences.slice(0, 15).map((e: any) => ({
        company: typeof e?.company === 'string' ? e.company : undefined,
        position: typeof e?.position === 'string' ? e.position : undefined,
        description: stripHtml(e?.description),
        start: typeof e?.start === 'string' ? e.start : undefined,
        end: typeof e?.end === 'string' ? e.end : undefined,
      })),
      education: education.slice(0, 10).map((ed: any) => ({
        name: typeof ed?.name === 'string' ? ed.name : undefined,
        organization: typeof ed?.organization === 'string' ? ed.organization : undefined,
        result: typeof ed?.result === 'string' ? ed.result : undefined,
        year: typeof ed?.year === 'number' ? ed.year : undefined,
      })),
      professionalRoles: Array.isArray(raw?.professional_roles)
        ? raw.professional_roles.map((r: any) => typeof r?.name === 'string' ? r.name : null).filter(Boolean) as string[]
        : undefined,
      employments: Array.isArray(raw?.employments)
        ? raw.employments.map((e: any) => typeof e?.name === 'string' ? e.name : null).filter(Boolean) as string[]
        : undefined,
      schedules: Array.isArray(raw?.schedules)
        ? raw.schedules.map((s: any) => typeof s?.name === 'string' ? s.name : null).filter(Boolean) as string[]
        : undefined,
      updatedAt: typeof raw?.updated_at === 'string' ? raw.updated_at : undefined,
    }
  }

  const isOnNewStage = row.stageType === 'new' || row.stageType === 'applied'

  // ТЗ hm-review-substage: в режиме 'queue' решение доступно только на подэтапе «На рассмотрении»
  const reviewStage = row.jobPipelineId
    ? await resolveHmReviewStage({ organizationId: orgId, pipelineId: row.jobPipelineId })
    : null
  const reviewMode: 'queue' | 'legacy' = reviewStage ? 'queue' : 'legacy'
  const isInReview = reviewStage ? row.currentStageId === reviewStage.stageId : isOnNewStage

  return {
    application: {
      id: row.appId,
      status: row.appStatus,
      createdAt: row.appCreatedAt,
      stageChangedAt: row.stageChangedAt,
      currentStage: row.stageName
        ? { name: row.stageName, type: row.stageType }
        : null,
      isOnNewStage,
      /** ТЗ hm-review-substage: кандидат в очереди НМ (подэтап «На рассмотрении» или легаси new/applied). */
      isInReview,
    },
    reviewMode,
    candidate: {
      id: row.candidateId,
      fullName: row.displayName || `${row.firstName} ${row.lastName}`.trim(),
      city: row.city,
      aiSummary: row.aiSummary,
      expectedSalary,
      resume: resumeSnapshot,
    },
    job: {
      id: row.jobId,
      title: row.jobTitle,
      location: row.jobLocation,
    },
    effectiveDecision: effective ?? null,
    /** true = НМ может нажимать «Одобрить/Отклонить». */
    canDecide: isInReview && !effective,
    permissions: {
      canViewSalary: session.hm.canViewSalary,
    },
  }
})
