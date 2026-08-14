import { z } from 'zod'
import { eq, and, count, ne } from 'drizzle-orm'
import { pipeline, job } from '../../database/schema'

const idParamSchema = z.object({ id: z.string().min(1) })

export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { pipeline: ['delete'] })
  const orgId = session.session.activeOrganizationId

  const { id } = await getValidatedRouterParams(event, idParamSchema.parse)

  const existing = await db.query.pipeline.findFirst({
    where: and(eq(pipeline.id, id), eq(pipeline.organizationId, orgId)),
    columns: { id: true, isSystem: true, isDefault: true },
  })

  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Воронка не найдена' })
  }

  if (existing.isSystem) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Системный пресет нельзя редактировать. Клонируйте его и редактируйте копию',
    })
  }

  if (existing.isDefault) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Нельзя удалить воронку по умолчанию. Сначала назначьте другую воронку по умолчанию',
    })
  }

  // Check if any non-archived jobs use this pipeline
  const [jobsRow] = await db
    .select({ count: count() })
    .from(job)
    .where(and(
      eq(job.organizationId, orgId),
      eq(job.pipelineId, id),
      ne(job.status, 'archived'),
    ))

  const jobsCount = jobsRow?.count ?? 0
  if (jobsCount > 0) {
    throw createError({
      statusCode: 400,
      statusMessage: `Воронка используется в ${jobsCount} вакансиях. Сначала перенесите вакансии на другую воронку`,
    })
  }

  // Soft-delete: archive, do NOT hard delete
  await db.update(pipeline)
    .set({ isArchived: true, updatedAt: new Date() })
    .where(and(eq(pipeline.id, id), eq(pipeline.organizationId, orgId)))

  setResponseStatus(event, 204)
  return null
})
