import { eq } from 'drizzle-orm'
import * as schema from '../database/schema'
import { STAGE_COLORS } from './pipeline-colors'

// Accept any Drizzle DB instance that has the required tables.
// This keeps the function compatible with both the server Proxy-wrapped
// db instance and the raw drizzle() instance used in scripts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = any

/**
 * Seeds a "Стандартная" system pipeline preset for the given organization.
 *
 * The preset mirrors the legacy `applicationStatusEnum` stages so that the
 * old enum-based flow and the new pipeline flow stay in sync during migration.
 *
 * Idempotent — if the org already has a system pipeline this function returns
 * early without making any changes.
 *
 * @param db            Drizzle database instance
 * @param organizationId  Organization to seed the pipeline for
 */
export async function seedSystemPipelineForOrg(db: DB, organizationId: string): Promise<void> {
  // Guard: skip if a system pipeline already exists for this org
  const [existing] = await db
    .select({ id: schema.pipeline.id })
    .from(schema.pipeline)
    .where(eq(schema.pipeline.organizationId, organizationId))
    .limit(1)

  if (existing) {
    return
  }

  const pipelineId = crypto.randomUUID()

  // 1. Create the system pipeline
  await db.insert(schema.pipeline).values({
    id: pipelineId,
    organizationId,
    name: 'Стандартная',
    description: 'Системный пресет ReqCore',
    isSystem: true,
    isDefault: true,
    isArchived: false,
  })

  // 2. Create the 6 default stages matching the old applicationStatusEnum order
  const stages: Array<typeof schema.pipelineStage.$inferInsert> = [
    {
      id: crypto.randomUUID(),
      organizationId,
      pipelineId,
      name: 'Новый',
      type: 'applied',
      color: STAGE_COLORS.applied,
      displayOrder: 0,
      isTerminal: false,
      isArchived: false,
    },
    {
      id: crypto.randomUUID(),
      organizationId,
      pipelineId,
      name: 'Скрининг',
      type: 'screening',
      color: STAGE_COLORS.screening,
      displayOrder: 1,
      isTerminal: false,
      isArchived: false,
    },
    {
      id: crypto.randomUUID(),
      organizationId,
      pipelineId,
      name: 'Интервью',
      type: 'interview',
      color: STAGE_COLORS.interview,
      displayOrder: 2,
      isTerminal: false,
      isArchived: false,
    },
    {
      id: crypto.randomUUID(),
      organizationId,
      pipelineId,
      name: 'Оффер',
      type: 'offer',
      color: STAGE_COLORS.offer,
      displayOrder: 3,
      isTerminal: false,
      isArchived: false,
    },
    {
      id: crypto.randomUUID(),
      organizationId,
      pipelineId,
      name: 'Принят',
      type: 'hired',
      color: STAGE_COLORS.hired,
      displayOrder: 4,
      isTerminal: true,
      isArchived: false,
    },
    {
      id: crypto.randomUUID(),
      organizationId,
      pipelineId,
      name: 'Отказ',
      type: 'rejected',
      color: STAGE_COLORS.rejected,
      displayOrder: 5,
      isTerminal: true,
      isArchived: false,
    },
  ]

  await db.insert(schema.pipelineStage).values(stages)
}
