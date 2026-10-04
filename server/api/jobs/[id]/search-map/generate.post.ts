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
import { generateStructuredOutput } from '../../../../utils/ai/provider'

const aiOutputSchema = z.object({
  summary: z.string().nullish(),
  sections: z.array(z.object({
    sectionType: z.enum(['key_skills', 'must_have', 'nice_to_have', 'geo_format', 'level_domain', 'custom']),
    items: z.array(z.object({
      value: z.string(),
      note: z.string().nullish(),
    })),
  })).optional(),
  donors: z.array(z.object({
    name: z.string(),
    layer: z.enum(['core', 'adjacent', 'school', 'alumni', 'custom']),
    priority: z.enum(['p1', 'p2', 'p3']),
    rationale: z.string(),
    industry: z.string().nullish(),
    techStack: z.array(z.string()).optional(),
  })).optional(),
  segments: z.array(z.object({
    name: z.string(),
    donorLayer: z.enum(['core', 'adjacent', 'school', 'alumni', 'custom']).nullish(),
    titles: z.array(z.string()),
    keywords: z.array(z.string()),
    geo: z.array(z.string()),
    channelCode: z.string(),
    queryString: z.string().nullish(),
    priority: z.enum(['p1', 'p2', 'p3']),
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
    hint: body.hint,
  })

  const aiConfig = await loadAiConfig(orgId as string, { purpose: 'analysis' })
  const { object: aiResult, responseModel } = await generateStructuredOutput(aiConfig, {
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
  if (aiResult.sections) {
    for (const aiSection of aiResult.sections) {
      const [section] = await db.select().from(jobSearchMapSection)
        .where(and(eq(jobSearchMapSection.mapId, map.id), eq(jobSearchMapSection.sectionType, aiSection.sectionType))).limit(1)

      if (section) {
        if (mode === 'append') {
          const existing = await db.select().from(jobSearchMapItem).where(eq(jobSearchMapItem.sectionId, section.id))
          let order = existing.length
          for (const item of aiSection.items) {
            if (existing.some(e => e.value.toLowerCase() === item.value.toLowerCase())) continue
            await db.insert(jobSearchMapItem).values({
              mapId: map.id, sectionId: section.id, organizationId: orgId as string,
              value: item.value, note: item.note ?? null, origin: 'ai', displayOrder: order++,
            })
            itemsAdded++
          }
        }
      } else {
        const sectionId = crypto.randomUUID()
        const sectionOrder = existingSections.length
        await db.insert(jobSearchMapSection).values({
          id: sectionId, mapId: map.id, organizationId: orgId as string,
          sectionType: aiSection.sectionType,
          title: aiSection.sectionType.replace(/_/g, ' '),
          displayOrder: sectionOrder,
        })
        for (let i = 0; i < aiSection.items.length; i++) {
          await db.insert(jobSearchMapItem).values({
            mapId: map.id, sectionId, organizationId: orgId as string,
            value: aiSection.items[i].value, note: aiSection.items[i].note ?? null,
            origin: 'ai', displayOrder: i,
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
