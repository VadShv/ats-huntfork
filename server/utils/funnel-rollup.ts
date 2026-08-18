import { eq, and, asc } from 'drizzle-orm'
import { pipeline, pipelineStage } from '../database/schema'

/**
 * Фаза 1 «словарь = воронка».
 * Общий ролл-ап этапов организации до корневых этапов —
 * используется аналитикой источников и трекинг-ссылок,
 * чтобы воронки везде показывали реальные названия этапов,
 * а не легаси-статусы.
 */

export interface FunnelStageColumn {
  id: string
  pipelineId: string
  pipelineName: string
  name: string
  color: string
  type: string
  bucket: 'working' | 'rejected'
  displayOrder: number
}

export interface OrgStageRollup {
  /** stageId (включая подэтапы) → id корневого этапа */
  stageToRoot: Record<string, string>
  /** Корневые этапы всех не-архивных воронок организации, по порядку */
  rootColumns: FunnelStageColumn[]
}

export async function getOrgStageRollup(orgId: string): Promise<OrgStageRollup> {
  const rows = await db
    .select({
      id: pipelineStage.id,
      pipelineId: pipelineStage.pipelineId,
      pipelineName: pipeline.name,
      name: pipelineStage.name,
      color: pipelineStage.color,
      type: pipelineStage.type,
      bucket: pipelineStage.bucket,
      displayOrder: pipelineStage.displayOrder,
      parentStageId: pipelineStage.parentStageId,
      isHidden: pipelineStage.isHidden,
    })
    .from(pipelineStage)
    .innerJoin(pipeline, eq(pipeline.id, pipelineStage.pipelineId))
    .where(and(
      eq(pipelineStage.organizationId, orgId),
      eq(pipeline.isArchived, false),
    ))
    .orderBy(asc(pipeline.createdAt), asc(pipelineStage.displayOrder))

  const stageToRoot: Record<string, string> = {}
  for (const s of rows) {
    stageToRoot[s.id] = s.parentStageId ?? s.id
  }

  const rootColumns: FunnelStageColumn[] = rows
    .filter(s => s.parentStageId === null && !s.isHidden)
    .map(s => ({
      id: s.id,
      pipelineId: s.pipelineId,
      pipelineName: s.pipelineName,
      name: s.name,
      color: s.color,
      type: s.type,
      bucket: s.bucket as 'working' | 'rejected',
      displayOrder: s.displayOrder,
    }))

  return { stageToRoot, rootColumns }
}
