import { eq, and } from 'drizzle-orm'
import { z } from 'zod'
import {
  jobSearchMap, jobSearchMapSection, jobSearchMapItem, jobSearchMapDonor, jobSearchMapSegment,
  jobSearchMapVersion,
} from '../../../../../../database/schema/app'
import { snapshotMap } from '../../../../../../utils/searchMap/snapshotMap'

const paramsSchema = z.object({ id: z.string().min(1), versionId: z.string().min(1) })

/**
 * POST /api/jobs/[id]/search-map/versions/[versionId]/restore
 * Восстановить состояние карты из версии.
 * Право: searchMap:edit
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { searchMap: ['edit'] })
  const orgId = session.session.activeOrganizationId
  const { id: jobId, versionId } = await getValidatedRouterParams(event, paramsSchema.parse)
  await requireJobInScope(event, jobId)

  const [map] = await db.select().from(jobSearchMap)
    .where(and(eq(jobSearchMap.jobId, jobId), eq(jobSearchMap.organizationId, orgId))).limit(1)
  if (!map) throw createError({ statusCode: 404, statusMessage: 'Карта не найдена' })

  const [version] = await db.select().from(jobSearchMapVersion)
    .where(and(eq(jobSearchMapVersion.mapId, map.id), eq(jobSearchMapVersion.id, versionId))).limit(1)
  if (!version) throw createError({ statusCode: 404, statusMessage: 'Версия не найдена' })

  const snap = version.snapshot as any

  // Save current state as a new version before restoring
  const currentSnapshot = await snapshotMap(map.id)
  const restoreVersionNo = map.currentVersionNo + 1
  await db.insert(jobSearchMapVersion).values({
    mapId: map.id,
    organizationId: orgId as string,
    versionNo: restoreVersionNo,
    label: `Перед восстановлением v${version.versionNo}`,
    trigger: 'manual',
    snapshot: currentSnapshot,
    sourceHashes: map.sourceHashes,
    createdById: session.user.id,
  })

  // Wipe current state
  await db.delete(jobSearchMapItem).where(eq(jobSearchMapItem.mapId, map.id))
  await db.delete(jobSearchMapSection).where(eq(jobSearchMapSection.mapId, map.id))
  await db.delete(jobSearchMapSegment).where(eq(jobSearchMapSegment.mapId, map.id))
  await db.delete(jobSearchMapDonor).where(eq(jobSearchMapDonor.mapId, map.id))

  // Restore sections + items.
  // sectionType обязателен (NOT NULL + unique(mapId, sectionType)); старые снапшоты его не хранили —
  // для них восстанавливаем тип по заголовку, иначе берём первый свободный.
  const SECTION_TYPES = ['title_synonyms', 'keywords', 'geo', 'exclusions', 'notes'] as const
  type SectionType = (typeof SECTION_TYPES)[number]
  const TITLE_TO_TYPE: Record<string, SectionType> = {
    'тайтлы и синонимы': 'title_synonyms',
    'ключевые слова и навыки': 'keywords',
    'география': 'geo',
    'исключения': 'exclusions',
    'заметки и договорённости': 'notes',
    'заметки': 'notes',
  }
  const usedTypes = new Set<SectionType>()
  const normalizeItem = (v: string) => v.toLowerCase().trim().replace(/ё/g, 'е')

  for (const s of snap.sections ?? []) {
    let sectionType: SectionType | undefined = SECTION_TYPES.includes(s.sectionType) ? s.sectionType : undefined
    if (!sectionType) sectionType = TITLE_TO_TYPE[(s.title ?? '').toLowerCase().trim()]
    if (!sectionType || usedTypes.has(sectionType)) sectionType = SECTION_TYPES.find(t => !usedTypes.has(t))
    if (!sectionType) continue // все 5 типов уже восстановлены — лишнюю секцию пропускаем
    usedTypes.add(sectionType)

    const sectionId = crypto.randomUUID()
    await db.insert(jobSearchMapSection).values({
      id: sectionId,
      mapId: map.id,
      organizationId: orgId as string,
      sectionType,
      isRequired: s.isRequired ?? false,
      title: s.title,
      guidance: s.guidance ?? null,
      displayOrder: s.displayOrder,
    })
    const seen = new Set<string>()
    for (const item of s.items ?? []) {
      const normalizedValue = normalizeItem(item.value)
      if (seen.has(normalizedValue)) continue
      seen.add(normalizedValue)
      await db.insert(jobSearchMapItem).values({
        mapId: map.id,
        sectionId,
        organizationId: orgId as string,
        value: item.value,
        normalizedValue,
        note: item.note ?? null,
        origin: item.origin ?? 'manual',
        displayOrder: item.displayOrder,
      })
    }
  }

  // Restore donors
  for (const d of snap.donors ?? []) {
    await db.insert(jobSearchMapDonor).values({
      mapId: map.id,
      organizationId: orgId as string,
      donorCompanyId: d.donorCompanyId,
      layer: d.layer,
      priority: d.priority,
      rationale: d.rationale ?? null,
      hypothesisStatus: d.hypothesisStatus,
      displayOrder: d.displayOrder,
    })
  }

  // Restore segments
  for (const s of snap.segments ?? []) {
    await db.insert(jobSearchMapSegment).values({
      mapId: map.id,
      organizationId: orgId as string,
      name: s.name,
      donorLayer: s.donorLayer ?? null,
      titles: s.titles,
      geo: s.geo,
      channelId: s.channelId ?? null,
      queryString: s.queryString ?? null,
      queryUrl: s.queryUrl ?? null,
      priority: s.priority,
      hypothesisStatus: s.hypothesisStatus,
      displayOrder: s.displayOrder,
    })
  }

  // Update map
  await db.update(jobSearchMap).set({
    summary: snap.summary ?? null,
    currentVersionNo: restoreVersionNo,
    sourceHashes: version.sourceHashes as { brief: string | null; criteria: string | null; description: string | null },
    updatedAt: new Date(),
  }).where(eq(jobSearchMap.id, map.id))

  return { restoredTo: version.versionNo, newVersionNo: restoreVersionNo }
})
