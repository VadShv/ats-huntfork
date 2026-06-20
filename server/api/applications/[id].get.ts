import { eq, and } from 'drizzle-orm'
import { application, pipelineStage } from '../../database/schema'
import { applicationIdParamSchema } from '../../utils/schemas/application'
import { loadPropertyEntriesForEntity } from '../../utils/properties'

/**
 * GET /api/applications/:id
 * Single application detail with related candidate, job, question responses,
 * and pipeline stage info.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { application: ['read'] })
  const orgId = session.session.activeOrganizationId

  const { id } = await getValidatedRouterParams(event, applicationIdParamSchema.parse)

  const result = await db.query.application.findFirst({
    where: and(eq(application.id, id), eq(application.organizationId, orgId)),
    with: {
      candidate: {
        columns: { id: true, firstName: true, lastName: true, email: true, phone: true },
        with: {
          documents: {
            columns: {
              id: true,
              type: true,
              originalFilename: true,
              mimeType: true,
              createdAt: true,
            },
            orderBy: (document, { desc }) => [desc(document.createdAt)],
          },
        },
      },
      job: {
        columns: { id: true, title: true, status: true, slug: true, pipelineId: true },
      },
      responses: {
        with: {
          question: {
            columns: { id: true, label: true, type: true, options: true },
          },
        },
        orderBy: (r, { asc }) => [asc(r.createdAt)],
      },
    },
    columns: {
      id: true,
      organizationId: true,
      candidateId: true,
      jobId: true,
      status: true,
      currentStageId: true,
      stageChangedAt: true,
      score: true,
      needsManualReview: true,
      notes: true,
      coverLetterText: true,
      // Sprint 3: source нужен в UI для бейджей (hh / hh_sourcing / manual / api)
      source: true,
      createdAt: true,
      updatedAt: true,
    },
  })

  if (!result) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }

  // Load current stage details if available
  let currentStage: { id: string; name: string; color: string; type: string; isTerminal: boolean } | null = null
  if (result.currentStageId) {
    const stage = await db.query.pipelineStage.findFirst({
      where: eq(pipelineStage.id, result.currentStageId),
      columns: { id: true, name: true, color: true, type: true, isTerminal: true },
    })
    if (stage) {
      currentStage = stage
    }
  }

  const properties = await loadPropertyEntriesForEntity({
    organizationId: orgId,
    entityType: 'application',
    entityId: result.id,
    jobId: result.jobId,
  })

  return { ...result, currentStage, properties }
})
