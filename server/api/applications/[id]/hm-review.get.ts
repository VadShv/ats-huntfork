import { and, eq } from 'drizzle-orm'
import { application, job } from '../../../database/schema'
import { jobMember } from '../../../database/schema/hm'
import { applicationIdParamSchema } from '../../../utils/schemas/application'
import { resolveHmReviewStage } from '../../../utils/hm-stage-resolver'

/**
 * GET /api/applications/:id/hm-review
 * ТЗ hm-review-substage (П3): данные для действия «На рассмотрение НМ» в UI рекрутера.
 * Возвращает:
 *   - stage: подэтап «На рассмотрении» (preset_key='hm_review') воронки вакансии или null;
 *   - hasHiringManager: назначен ли на вакансию хотя бы один НМ (member_role='hiring_manager').
 * Действие в UI показывается только когда stage != null и hasHiringManager=true.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { application: ['read'] })
  const orgId = session.session.activeOrganizationId

  const { id } = await getValidatedRouterParams(event, applicationIdParamSchema.parse)

  const app = await db.query.application.findFirst({
    where: and(eq(application.id, id), eq(application.organizationId, orgId)),
    columns: { id: true, jobId: true },
  })
  if (!app) {
    throw createError({ statusCode: 404, statusMessage: 'Отклик не найден' })
  }

  const jobRow = await db.query.job.findFirst({
    where: and(eq(job.id, app.jobId), eq(job.organizationId, orgId)),
    columns: { id: true, pipelineId: true },
  })
  if (!jobRow?.pipelineId) {
    return { stage: null, hasHiringManager: false }
  }

  const stage = await resolveHmReviewStage({ organizationId: orgId, pipelineId: jobRow.pipelineId })

  let hasHiringManager = false
  if (stage) {
    const [member] = await db
      .select({ id: jobMember.id })
      .from(jobMember)
      .where(and(
        eq(jobMember.organizationId, orgId),
        eq(jobMember.jobId, jobRow.id),
        eq(jobMember.memberRole, 'hiring_manager'),
      ))
      .limit(1)
    hasHiringManager = Boolean(member)
  }

  return { stage, hasHiringManager }
})
