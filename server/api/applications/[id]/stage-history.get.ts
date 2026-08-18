import { eq, and, inArray } from 'drizzle-orm'
import { applicationStageHistory, application, pipelineStage } from '../../../database/schema'
import { applicationIdParamSchema } from '../../../utils/schemas/application'

/**
 * GET /api/applications/:id/stage-history
 * Returns the full stage-move audit trail for a single application.
 *
 * Scoped to org. Left-joins pipelineStage twice (fromStage, toStage) and
 * user (movedByUser) to resolve human-readable names and colors.
 *
 * Ordered: movedAt DESC (newest first).
 * Returns [] if the application has no history yet.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { application: ['read'] })
  const orgId = session.session.activeOrganizationId

  const { id } = await getValidatedRouterParams(event, applicationIdParamSchema.parse)

  // Verify the application exists and belongs to this org
  const app = await db.query.application.findFirst({
    where: and(eq(application.id, id), eq(application.organizationId, orgId)),
    columns: { id: true },
  })

  if (!app) {
    throw createError({ statusCode: 404, statusMessage: 'Отклик не найден' })
  }

  // Use Drizzle relational queries — relations are defined in schema
  // (fromStage, toStage, movedByUser are declared in applicationStageHistoryRelations)
  const rows = await db.query.applicationStageHistory.findMany({
    where: and(
      eq(applicationStageHistory.applicationId, id),
      eq(applicationStageHistory.organizationId, orgId),
    ),
    with: {
      fromStage: {
        columns: { id: true, name: true, color: true, parentStageId: true },
      },
      toStage: {
        columns: { id: true, name: true, color: true, parentStageId: true },
      },
      movedByUser: {
        columns: { id: true, name: true },
      },
    },
    orderBy: (h, { desc }) => [desc(h.movedAt)],
  })

  // Спринт 22: для подэтапов (например причин отказа) отдаём имя родителя,
  // чтобы UI показывал «Отказ / Не подходит», а не голое «Не подходит».
  const parentIds = [...new Set(
    rows.flatMap((r) => [r.fromStage?.parentStageId, r.toStage?.parentStageId]).filter((v): v is string => !!v),
  )]
  const parentNameById = new Map<string, string>()
  if (parentIds.length > 0) {
    const parents = await db
      .select({ id: pipelineStage.id, name: pipelineStage.name })
      .from(pipelineStage)
      .where(and(eq(pipelineStage.organizationId, orgId), inArray(pipelineStage.id, parentIds)))
    for (const p of parents) parentNameById.set(p.id, p.name)
  }

  return rows.map((row) => ({
    id: row.id,
    fromStageId: row.fromStageId ?? null,
    fromStageName: row.fromStage?.name ?? null,
    fromStageColor: row.fromStage?.color ?? null,
    fromStageParentName: row.fromStage?.parentStageId ? (parentNameById.get(row.fromStage.parentStageId) ?? null) : null,
    toStageId: row.toStageId,
    toStageName: row.toStage.name,
    toStageColor: row.toStage.color,
    toStageParentName: row.toStage.parentStageId ? (parentNameById.get(row.toStage.parentStageId) ?? null) : null,
    movedByUserId: row.movedByUserId ?? null,
    movedByUserName: row.movedByUser?.name ?? null,
    comment: row.comment ?? null,
    movedAt: row.movedAt.toISOString(),
  }))
})
