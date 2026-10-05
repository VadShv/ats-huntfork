import { eq, and, asc } from 'drizzle-orm'
import { z } from 'zod'
import {
  job, jobBrief, scoringCriterion,
  jobSearchMap, jobSearchMapSection, jobSearchMapItem, jobSearchMapDonor, jobSearchMapSegment,
  donorCompany, sourcingChannel,
} from '../../../../database/schema/app'
import { generateInputSchema } from '../../../../utils/schemas/searchMap'
import { buildGeneratePrompt } from '../../../../utils/searchMap/buildGeneratePrompt'
import { normalizeCompanyName } from '../../../../utils/searchMap/normalizeCompanyName'
import { loadAiConfig } from '../../../../utils/ai/loadConfig'
import { generateStructuredOutput, type SupportedProvider } from '../../../../utils/ai/provider'

// ВАЖНО: словарь ответа ИИ обязан совпадать с enum'ами БД
// (search_map_section_type, search_map_priority, search_map_donor_layer).
// Раньше здесь были 'key_skills'/'p1' и т.п. — Postgres отклонял insert → 500 на «Дополнить по брифу».
const SECTION_TYPES = ['title_synonyms', 'keywords', 'geo', 'exclusions', 'notes'] as const
const PRIORITIES = ['high', 'medium', 'low'] as const
const LAYERS = ['core', 'adjacent', 'school', 'alumni', 'custom'] as const

// Та же нормализация, что в sections/[sectionId]/items.post.ts (колонка normalized_value NOT NULL,
// без неё insert падал).
const normalizeItemValue = (v: string) => v.toLowerCase().trim().replace(/ё/g, 'е')

const SECTION_TITLES: Record<(typeof SECTION_TYPES)[number], string> = {
  title_synonyms: 'Тайтлы и синонимы',
  keywords: 'Ключевые слова и навыки',
  geo: 'География',
  exclusions: 'Исключения',
  notes: 'Заметки',
}

const aiOutputSchema = z.object({
  summary: z.string().nullish(),
  sections: z.array(z.object({
    sectionType: z.enum(SECTION_TYPES),
    items: z.array(z.object({
      value: z.string(),
      note: z.string().nullish(),
    })),
  })).optional(),
  donors: z.array(z.object({
    name: z.string(),
    layer: z.enum(LAYERS),
    priority: z.enum(PRIORITIES),
    rationale: z.string(),
    industry: z.string().nullish(),
    techStack: z.array(z.string()).optional(),
  })).optional(),
  segments: z.array(z.object({
    name: z.string(),
    donorLayer: z.enum(LAYERS).nullish(),
    titles: z.array(z.string()),
    keywords: z.array(z.string()),
    geo: z.array(z.string()),
    channelCode: z.string(),
    queryString: z.string().nullish(),
    priority: z.enum(PRIORITIES),
  })).optional(),
})

/**
 * POST /api/jobs/[id]/search-map/generate — AI-генерация контента карты.
 * Право: searchMap:edit
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { searchMap: ['edit'] })
  const orgId = session.session.activeOrganizationId
  const userId = session.user.id
  const { id: jobId } = await getValidatedRouterParams(event, z.object({ id: z.string().min(1) }).parse)
  await requireJobInScope(event, jobId)
  const body = await readValidatedBody(event, generateInputSchema.parse)

  const [j] = await db.select({ title: job.title, description: job.description }).from(job)
    .where(and(eq(job.id, jobId), eq(job.organizationId, orgId))).limit(1)
  if (!j) throw createError({ statusCode: 404, statusMessage: 'Вакансия не найдена' })

  const [map] = await db.select().from(jobSearchMap)
    .where(and(eq(jobSearchMap.jobId, jobId), eq(jobSearchMap.organizationId, orgId))).limit(1)
  if (!map) throw createError({ statusCode: 404, statusMessage: 'Карта не найдена' })

  const [brief] = await db.select().from(jobBrief)
    .where(and(eq(jobBrief.jobId, jobId), eq(jobBrief.organizationId, orgId))).limit(1)
  const criteria = await db.select({ name: scoringCriterion.name, category: scoringCriterion.category, weight: scoringCriterion.weight })
    .from(scoringCriterion)
    .where(and(eq(scoringCriterion.jobId, jobId), eq(scoringCriterion.organizationId, orgId)))

  const existingSections = await db.select().from(jobSearchMapSection)
    .where(eq(jobSearchMapSection.mapId, map.id)).orderBy(asc(jobSearchMapSection.displayOrder))
  const existingItems = await db.select().from(jobSearchMapItem)
    .where(eq(jobSearchMapItem.mapId, map.id))

  // Реальные коды каналов организации — иначе модель выдумывает 'hh_ru' и сегменты пропускаются.
  const activeChannels = await db.select({ code: sourcingChannel.code, name: sourcingChannel.name })
    .from(sourcingChannel)
    .where(and(eq(sourcingChannel.organizationId, orgId), eq(sourcingChannel.isActive, true)))
    .orderBy(asc(sourcingChannel.displayOrder))

  const existingDonorRows = await db.select({ name: donorCompany.canonicalName, layer: jobSearchMapDonor.layer })
    .from(jobSearchMapDonor)
    .innerJoin(donorCompany, eq(donorCompany.id, jobSearchMapDonor.donorCompanyId))
    .where(eq(jobSearchMapDonor.mapId, map.id))

  const { system, prompt } = buildGeneratePrompt({
    scope: body.scope,
    jobTitle: j.title,
    brief: brief ?? undefined,
    criteria,
    description: j.description ?? undefined,
    existingSections: existingSections.map(s => ({
      title: s.title,
      items: existingItems.filter(i => i.sectionId === s.id).map(i => i.value),
    })),
    existingDonors: existingDonorRows,
    channels: activeChannels,
    hint: body.hint,
  })

  const aiConfig = await loadAiConfig(orgId as string, { purpose: 'analysis' })
  const { object: aiResult, responseModel } = await generateStructuredOutput({
    ...aiConfig,
    provider: aiConfig.provider as SupportedProvider,
  }, {
    system,
    prompt,
    schema: aiOutputSchema,
    schemaName: 'searchMapGeneration',
    schemaDescription: 'AI-generated search map content',
    temperature: 0.3,
    disableThinking: true,
  })

  const warnings: string[] = []
  const mode = body.mode ?? 'append'

  // Apply summary
  if (aiResult.summary && (mode === 'append' || !map.summary)) {
    await db.update(jobSearchMap).set({ summary: aiResult.summary, updatedAt: new Date() }).where(eq(jobSearchMap.id, map.id))
  }

  // Apply sections
  let itemsAdded = 0
  let createdSections = 0
  if (aiResult.sections) {
    for (const aiSection of aiResult.sections) {
      const [section] = await db.select().from(jobSearchMapSection)
        .where(and(eq(jobSearchMapSection.mapId, map.id), eq(jobSearchMapSection.sectionType, aiSection.sectionType))).limit(1)

      if (section) {
        if (mode === 'append') {
          const existing = await db.select().from(jobSearchMapItem).where(eq(jobSearchMapItem.sectionId, section.id))
          const seen = new Set(existing.map(e => e.normalizedValue))
          let order = existing.length
          for (const item of aiSection.items) {
            const normalizedValue = normalizeItemValue(item.value)
            if (!normalizedValue || seen.has(normalizedValue)) continue
            seen.add(normalizedValue)
            await db.insert(jobSearchMapItem).values({
              mapId: map.id, sectionId: section.id, organizationId: orgId as string,
              value: item.value, normalizedValue, note: item.note ?? null, origin: 'ai', displayOrder: order++,
            })
            itemsAdded++
          }
        }
      } else {
        const sectionId = crypto.randomUUID()
        const sectionOrder = existingSections.length + createdSections
        await db.insert(jobSearchMapSection).values({
          id: sectionId, mapId: map.id, organizationId: orgId as string,
          sectionType: aiSection.sectionType,
          title: SECTION_TITLES[aiSection.sectionType],
          displayOrder: sectionOrder,
        })
        createdSections++
        const seen = new Set<string>()
        let i = 0
        for (const item of aiSection.items) {
          const normalizedValue = normalizeItemValue(item.value)
          if (!normalizedValue || seen.has(normalizedValue)) continue
          seen.add(normalizedValue)
          await db.insert(jobSearchMapItem).values({
            mapId: map.id, sectionId, organizationId: orgId as string,
            value: item.value, normalizedValue, note: item.note ?? null,
            origin: 'ai', displayOrder: i++,
          })
          itemsAdded++
        }
      }
    }
  }

  // Apply donors
  let donorsAdded = 0
  if (aiResult.donors) {
    const existingDonors = await db.select().from(jobSearchMapDonor).where(eq(jobSearchMapDonor.mapId, map.id))
    let order = existingDonors.length
    for (const d of aiResult.donors) {
      const normalized = normalizeCompanyName(d.name)
      let [company] = await db.select().from(donorCompany)
        .where(and(eq(donorCompany.organizationId, orgId), eq(donorCompany.normalizedName, normalized))).limit(1)

      if (!company) {
        [company] = await db.insert(donorCompany).values({
          organizationId: orgId, canonicalName: d.name, normalizedName: normalized,
          industry: d.industry ?? null, techStack: d.techStack ?? [],
          createdById: userId, createdFromJobId: jobId,
        }).returning()
      }

      const already = existingDonors.some(ed => ed.donorCompanyId === company!.id)
      if (already && mode === 'append') continue

      await db.insert(jobSearchMapDonor).values({
        organizationId: orgId, mapId: map.id, donorCompanyId: company.id,
        layer: d.layer, priority: d.priority, rationale: d.rationale,
        origin: 'ai', displayOrder: order++,
      })
      donorsAdded++
    }
  }

  // Apply segments
  let segmentsAdded = 0
  if (aiResult.segments) {
    const existingSegments = await db.select().from(jobSearchMapSegment).where(eq(jobSearchMapSegment.mapId, map.id))
    let order = existingSegments.length
    for (const s of aiResult.segments) {
      const [channel] = await db.select().from(sourcingChannel)
        .where(and(eq(sourcingChannel.organizationId, orgId), eq(sourcingChannel.code, s.channelCode))).limit(1)

      if (!channel) {
        warnings.push(`Канал "${s.channelCode}" не найден — сегмент "${s.name}" пропущен`)
        continue
      }

      await db.insert(jobSearchMapSegment).values({
        organizationId: orgId, mapId: map.id,
        name: s.name, donorLayer: s.donorLayer ?? null,
        titles: s.titles, keywords: s.keywords, geo: s.geo,
        channelId: channel.id, queryString: s.queryString ?? null,
        priority: s.priority, origin: 'ai', displayOrder: order++,
      })
      segmentsAdded++
    }
  }

  return {
    scope: body.scope,
    model: responseModel ?? aiConfig.model,
    summary: aiResult.summary,
    itemsAdded,
    donorsAdded,
    segmentsAdded,
    warnings,
  }
})
