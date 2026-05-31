import { eq, and, asc, inArray } from 'drizzle-orm'
import { pipeline, pipelineStage, application } from '../database/schema'

// Accept any Drizzle DB instance
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = any

/**
 * Returns the first non-archived stage (lowest displayOrder) for the given pipeline.
 * Returns null if the pipeline has no active stages.
 */
export async function getEntryStageForPipeline(
  db: DB,
  pipelineId: string,
): Promise<{ id: string } | null> {
  const [stage] = await db
    .select({ id: pipelineStage.id })
    .from(pipelineStage)
    .where(
      and(
        eq(pipelineStage.pipelineId, pipelineId),
        eq(pipelineStage.isArchived, false),
      ),
    )
    .orderBy(asc(pipelineStage.displayOrder))
    .limit(1)

  return stage ?? null
}

/**
 * Returns the default (non-archived) pipeline for the given organization.
 * Prefers isDefault=true, falls back to isSystem=true if no default exists.
 * Returns null if neither is found.
 */
export async function getDefaultPipelineForOrg(
  db: DB,
  organizationId: string,
): Promise<{ id: string } | null> {
  // Try the org's designated default pipeline first
  const [defaultPipeline] = await db
    .select({ id: pipeline.id })
    .from(pipeline)
    .where(
      and(
        eq(pipeline.organizationId, organizationId),
        eq(pipeline.isDefault, true),
        eq(pipeline.isArchived, false),
      ),
    )
    .limit(1)

  if (defaultPipeline) return defaultPipeline

  // Fall back to any system pipeline
  const [systemPipeline] = await db
    .select({ id: pipeline.id })
    .from(pipeline)
    .where(
      and(
        eq(pipeline.organizationId, organizationId),
        eq(pipeline.isSystem, true),
        eq(pipeline.isArchived, false),
      ),
    )
    .limit(1)

  return systemPipeline ?? null
}

/**
 * Counts the number of active (non-terminal) applications for the given job.
 *
 * An application is considered active when:
 * - It has a currentStageId pointing to a non-terminal pipeline stage, OR
 * - It has no currentStageId (pipeline not yet assigned) AND its legacy
 *   enum status is NOT 'hired' or 'rejected' (back-compat with old enum flow).
 */
export async function countActiveApplicationsForJob(
  db: DB,
  jobId: string,
): Promise<number> {
  // Load all applications for the job
  const applications: Array<{
    id: string
    status: string
    currentStageId: string | null
  }> = await db
    .select({
      id: application.id,
      status: application.status,
      currentStageId: application.currentStageId,
    })
    .from(application)
    .where(eq(application.jobId, jobId))

  if (applications.length === 0) return 0

  // Collect distinct non-null currentStageIds so we can check isTerminal
  const stageIdSet = new Set<string>()
  for (const a of applications) {
    if (a.currentStageId) stageIdSet.add(a.currentStageId)
  }
  const stageIds = [...stageIdSet]

  // Build a map of stageId → isTerminal
  const terminalMap = new Map<string, boolean>()
  if (stageIds.length > 0) {
    const stages: Array<{ id: string; isTerminal: boolean }> = await db
      .select({ id: pipelineStage.id, isTerminal: pipelineStage.isTerminal })
      .from(pipelineStage)
      .where(inArray(pipelineStage.id, stageIds))

    for (const s of stages) {
      terminalMap.set(s.id, s.isTerminal)
    }
  }

  let activeCount = 0
  for (const app of applications) {
    if (app.currentStageId !== null) {
      // Pipeline-tracked application: active iff stage is non-terminal
      const isTerminal = terminalMap.get(app.currentStageId) ?? false
      if (!isTerminal) activeCount++
    } else {
      // Legacy enum-tracked application: active iff status is not a final state
      if (app.status !== 'hired' && app.status !== 'rejected') activeCount++
    }
  }

  return activeCount
}
