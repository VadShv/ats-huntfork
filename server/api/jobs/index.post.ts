import { eq, and } from 'drizzle-orm'
import { job, pipeline, company, department } from '../../database/schema'
import { jobMember } from '../../database/schema/hm'
import { createJobSchema } from '../../utils/schemas/job'
import { getDefaultPipelineForOrg } from '../../utils/pipeline-helpers'

export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { job: ['create'] })
  const orgId = session.session.activeOrganizationId

  const body = await readValidatedBody(event, createJobSchema.parse)

  // ─────────────────────────────────────────────
  // Resolve pipeline
  // ─────────────────────────────────────────────

  let resolvedPipelineId: string | null = null

  if (body.pipelineId) {
    // Validate the provided pipeline exists in the same org and is not archived
    const existingPipeline = await db.query.pipeline.findFirst({
      where: and(
        eq(pipeline.id, body.pipelineId),
        eq(pipeline.organizationId, orgId),
        eq(pipeline.isArchived, false),
      ),
      columns: { id: true },
    })

    if (!existingPipeline) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Указанная воронка не найдена',
      })
    }

    resolvedPipelineId = existingPipeline.id
  } else {
    // Auto-resolve: use org default, fall back to system pipeline
    const defaultPipeline = await getDefaultPipelineForOrg(db, orgId)
    resolvedPipelineId = defaultPipeline?.id ?? null
  }

  // ─────────────────────────────────────────────
  // Resolve компания (юрлицо) и подразделение
  // ─────────────────────────────────────────────

  let resolvedCompanyId: string | null = null

  if (body.companyId) {
    const existingCompany = await db.query.company.findFirst({
      where: and(eq(company.id, body.companyId), eq(company.organizationId, orgId)),
      columns: { id: true },
    })
    if (!existingCompany) {
      throw createError({ statusCode: 400, statusMessage: 'Указанная компания не найдена' })
    }
    resolvedCompanyId = existingCompany.id
  } else if (body.companyId !== null) {
    // Не передано — подставляем компанию по умолчанию (null — явный отказ от привязки)
    const defaultCompany = await db.query.company.findFirst({
      where: and(eq(company.organizationId, orgId), eq(company.isDefault, true)),
      columns: { id: true },
    })
    resolvedCompanyId = defaultCompany?.id ?? null
  }

  let resolvedDepartmentId: string | null = null

  if (body.departmentId) {
    const existingDepartment = await db.query.department.findFirst({
      where: and(eq(department.id, body.departmentId), eq(department.organizationId, orgId)),
      columns: { id: true },
    })
    if (!existingDepartment) {
      throw createError({ statusCode: 400, statusMessage: 'Указанное подразделение не найдено' })
    }
    resolvedDepartmentId = existingDepartment.id
  }

  // Generate a deterministic ID upfront so we can build the slug
  const jobId = crypto.randomUUID()
  const slug = generateJobSlug(body.title, jobId, body.slug)

  const [created] = await db.insert(job).values({
    id: jobId,
    organizationId: orgId,
    title: body.title,
    slug,
    description: body.description,
    location: body.location,
    type: body.type,
    salaryMin: body.salaryMin,
    salaryMax: body.salaryMax,
    salaryCurrency: body.salaryCurrency,
    salaryUnit: body.salaryUnit,
    salaryNegotiable: body.salaryNegotiable,
    remoteStatus: body.remoteStatus,
    validThrough: body.validThrough,
    requireResume: body.requireResume,
    requireCoverLetter: body.requireCoverLetter,
    autoScoreOnApply: body.autoScoreOnApply,
    experienceLevel: body.experienceLevel,
    companyId: resolvedCompanyId,
    departmentId: resolvedDepartmentId,
    pipelineId: resolvedPipelineId,
  }).returning({
    id: job.id,
    title: job.title,
    slug: job.slug,
    description: job.description,
    location: job.location,
    type: job.type,
    status: job.status,
    salaryMin: job.salaryMin,
    salaryMax: job.salaryMax,
    salaryCurrency: job.salaryCurrency,
    salaryUnit: job.salaryUnit,
    salaryNegotiable: job.salaryNegotiable,
    remoteStatus: job.remoteStatus,
    validThrough: job.validThrough,
    requireResume: job.requireResume,
    requireCoverLetter: job.requireCoverLetter,
    autoScoreOnApply: job.autoScoreOnApply,
    experienceLevel: job.experienceLevel,
    pipelineId: job.pipelineId,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  })

  if (!created) {
    throw createError({ statusCode: 500, statusMessage: 'Не удалось создать вакансию' })
  }

  // Авто-назначение: создатель вакансии становится её рекрутером.
  // Право job:create есть только у owner/admin/member — все они валидные рекрутеры.
  // Не блокируем создание вакансии при сбое назначения.
  try {
    await db
      .insert(jobMember)
      .values({
        organizationId: orgId,
        jobId: created.id,
        userId: session.user.id,
        memberRole: 'recruiter',
        addedByUserId: session.user.id,
      })
      .onConflictDoNothing({ target: [jobMember.jobId, jobMember.userId, jobMember.memberRole] })
  }
  catch (err) {
    console.error('[jobs.post] Не удалось авто-назначить рекрутера на вакансию:', err)
  }

  recordActivity({
    organizationId: orgId,
    actorId: session.user.id,
    action: 'created',
    resourceType: 'job',
    resourceId: created.id,
    metadata: { title: created.title },
  })

  trackEvent(event, session, 'job created', {
    job_id: created.id,
    job_type: created.type,
    has_salary: !!(created.salaryMin || created.salaryMax),
    require_resume: created.requireResume,
    auto_score: created.autoScoreOnApply,
  })

  logApiRequest(event, session, 'job.created', {
    job_id: created.id,
    job_type: created.type,
    has_salary: !!(created.salaryMin || created.salaryMax),
    require_resume: created.requireResume,
    auto_score: created.autoScoreOnApply,
  })

  setResponseStatus(event, 201)
  return created
})
