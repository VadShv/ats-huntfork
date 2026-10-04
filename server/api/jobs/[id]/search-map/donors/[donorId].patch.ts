import { eq, and } from 'drizzle-orm'
import { z } from 'zod'
import { jobSearchMapDonor } from '../../../../../database/schema/app'

const paramsSchema = z.object({ id: z.string().min(1), donorId: z.string().min(1) })
const patchDonorSchema = z.object({
  layer: z.enum(['core', 'adjacent', 'school', 'alumni', 'custom']).optional(),
  priority: z.enum(['high', 'medium', 'low']).optional(),
  hypothesisStatus: z.enum(['untested', 'in_progress', 'working', 'rejected']).optional(),
  rationale: z.string().max(1000).nullish(),
  resultNote: z.string().max(2000).nullish(),
  displayOrder: z.number().int().min(0).optional(),
}).strict()

/**
 * PATCH /api/jobs/[id]/search-map/donors/[donorId] — правка донора в карте.
 * Право: searchMap:edit. rejected требует resultNote.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { searchMap: ['edit'] })
  const orgId = session.session.activeOrganizationId
  const { id: jobId, donorId } = await getValidatedRouterParams(event, paramsSchema.parse)
  const body = await readValidatedBody(event, patchDonorSchema.parse)
  await requireJobInScope(event, jobId)

  const [existing] = await db.select().from(jobSearchMapDonor)
    .where(and(eq(jobSearchMapDonor.id, donorId), eq(jobSearchMapDonor.organizationId, orgId))).limit(1)
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Донор не найден' })

  if (body.hypothesisStatus === 'rejected' && !body.resultNote && !existing.resultNote) {
    throw createError({ statusCode: 400, statusMessage: 'Укажите результат при отклонении' })
  }

  const patch: Record<string, unknown> = { updatedAt: new Date() }
  if (body.layer !== undefined) patch.layer = body.layer
  if (body.priority !== undefined) patch.priority = body.priority
  if (body.rationale !== undefined) patch.rationale = body.rationale
  if (body.resultNote !== undefined) patch.resultNote = body.resultNote
  if (body.displayOrder !== undefined) patch.displayOrder = body.displayOrder
  if (body.hypothesisStatus !== undefined && body.hypothesisStatus !== existing.hypothesisStatus) {
    patch.hypothesisStatus = body.hypothesisStatus
    patch.statusChangedAt = new Date()
    patch.statusChangedById = session.user.id
  }

  const [updated] = await db.update(jobSearchMapDonor).set(patch)
    .where(and(eq(jobSearchMapDonor.id, donorId), eq(jobSearchMapDonor.organizationId, orgId)))
    .returning()

  return updated
})
