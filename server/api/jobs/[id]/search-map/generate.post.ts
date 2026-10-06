import { eq, and, asc } from 'drizzle-orm'
import { z } from 'zod'
import {
  job, jobBrief, scoringCriterion,
  jobSearchMap, jobSearchMapSection, jobSearchMapItem, jobSearchMapDonor, jobSearchMapSegment,
  donorCompany, sourcingChannel,
} from '../../../../database/schema/app'
import { generateInputSchema } from '../../../../utils/schemas/searchMap'
import { buildGeneratePrompt } from '../../../../utils/searchMap/buildGeneratePrompt'
import { buildQueryUrl } from '../../../../utils/searchMap/buildQueryUrl'
import { normalizeCompanyName } from '../../../../utils/searchMap/normalizeCompanyName'
import {
  SECTION_TITLES, cleanList, normalizeItemValue, normalizeLayer, normalizePriority,
  normalizeSectionType, resolveChannel,
} from '../../../../utils/searchMap/normalizeAiVocab'
import { loadAiConfig } from '../../../../utils/ai/loadConfig'
import { generateStructuredOutput, type SupportedProvider } from '../../../../utils/ai/provider'

/**
 * POST /api/jobs/[id]/search-map/generate — AI-генерация содержимого карты.
 * Право: searchMap:edit
 *
 * Устойчивость (почему так):
 *  1. «full» разбит на ТРИ параллельных небольших вызова (секции / доноры / сегменты).
 *     Один большой ответ у reasoning-моделей шёл минутами и упирался в 300s-таймаут
 *     прокси/клиента; маленькие ответы быстрее и падают независимо.
 *  2. Схема ответа принимает строки, а не z.enum: модели пишут "P1", "hh.ru", "key_skills".
 *     Нормализация → enum'ы БД в normalizeAiVocab.ts; непонятное пропускается с warning.
 *  3. Частичный успех: если упал один вызов — остальные применяются, ошибка в warnings.
 *     Если упали все — 502 с текстом причины (а не безликий 500).
 */

const itemSchema = z.object({ value: z.string(), note: z.string().nullish() })

const sectionsOutputSchema = z.object({
  summary: z.string().nullish(),
  sections: z.array(z.object({
    sectionType: z.string(),
    title: z.string().nullish(),
    items: z.array(itemSchema).max(25),
  })).max(8).default([]),
})

const donorsOutputSchema = z.object({
  donors: z.array(z.object({
    name: z.string(),
    layer: z.string().nullish(),
    priority: z.string().nullish(),
    rationale: z.string().nullish(),
    industry: z.string().nullish(),
    techStack: z.array(z.string()).nullish(),
  })).max(20).default([]),
})

const segmentsOutputSchema = z.object({
  segments: z.array(z.object({
    name: z.string(),
    donorLayer: z.string().nullish(),
    titles: z.array(z.string()).nullish(),
    keywords: z.array(z.string()).nullish(),
    geo: z.array(z.string()).nullish(),
    channelCode: z.string().nullish(),
    queryString: z.string().nullish(),
    priority: z.string().nullish(),
    rationale: z.string().nullish(),
  })).max(10).default([]),
})

type SectionsOut = z.infer<typeof sectionsOutputSchema>
type DonorsOut = z.infer<typeof donorsOutputSchema>
type SegmentsOut = z.infer<typeof segmentsOutputSchema>

function errorText(err: unknown): string {
  const e = err as any
  const msg: string = e?.message ?? String(err)
  if (/abort|timed out/i.test(msg)) return 'модель не ответила за 300 секунд'
  if (/No object generated|schema|JSON/i.test(msg)) return 'модель вернула ответ не по схеме'
  if (/401|403|api key|unauthorized/i.test(msg)) return 'провайдер ИИ отклонил ключ (401/403)'
  if (/429|rate limit/i.test(msg)) return 'провайдер ИИ ограничил частоту запросов (429)'
  return msg.slice(0, 200)
}

export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { searchMap: ['edit'] })
  const orgId = session.session.activeOrganizationId
  const userId = session.user.id
  const { id: jobId } = await getValidatedRouterParams(event, z.object({ id: z.string().min(1) }).parse)
  await requireJobInScope(event, jobId)
  const body = await readValidatedBody(event, generateInputSchema.parse)
  const mode = body.mode ?? 'append'

  const [j] = await db.select({ title: job.title, description: job.description }).from(job)
    .where(and(eq(job.id, jobId), eq(job.organizationId, orgId))).limit(1)
  if (!j) throw createError({ statusCode: 404, statusMessage: 'Вакансия не найдена' })

  const [map] = await db.select().from(jobSearchMap)
    .where(and(eq(jobSearchMap.jobId, jobId), eq(jobSearchMap.organizationId, orgId))).limit(1)
  if (!map) throw createError({ statusCode: 404, statusMessage: 'Карта не найдена' })

  // ── Контекст для промпта ─────────────────────────────────────────
  const [brief] = await db.select().from(jobBrief)
    .where(and(eq(jobBrief.jobId, jobId), eq(jobBrief.organizationId, orgId))).limit(1)
  const criteria = await db.select({ name: scoringCriterion.name, category: scoringCriterion.category, weight: scoringCriterion.weight })
    .from(scoringCriterion)
    .where(and(eq(scoringCriterion.jobId, jobId), eq(scoringCriterion.organizationId, orgId)))

  const existingSections = await db.select().from(jobSearchMapSection)
    .where(eq(jobSearchMapSection.mapId, map.id)).orderBy(asc(jobSearchMapSection.displayOrder))
  const existingItems = await db.select().from(jobSearchMapItem)
    .where(eq(jobSearchMapItem.mapId, map.id))

  const activeChannels = await db.select().from(sourcingChannel)
    .where(and(eq(sourcingChannel.organizationId, orgId), eq(sourcingChannel.isActive, true)))
    .orderBy(asc(sourcingChannel.displayOrder))

  const existingDonorRows = await db.select({ name: donorCompany.canonicalName, layer: jobSearchMapDonor.layer })
    .from(jobSearchMapDonor)
    .innerJoin(donorCompany, eq(donorCompany.id, jobSearchMapDonor.donorCompanyId))
    .where(eq(jobSearchMapDonor.mapId, map.id))

  const promptBase = {
    jobTitle: j.title,
    brief: brief ?? undefined,
    criteria,
    description: j.description ?? undefined,
    existingSections: existingSections.map(s => ({
      title: s.title,
      items: existingItems.filter(i => i.sectionId === s.id).map(i => i.value),
    })),
    existingDonors: existingDonorRows,
    channels: activeChannels.map(c => ({ code: c.code, name: c.name })),
    hint: body.hint,
  }

  const aiConfigRow = await loadAiConfig(orgId as string, { purpose: 'analysis' })
  const aiConfig = { ...aiConfigRow, provider: aiConfigRow.provider as SupportedProvider }

  async function callAi<T>(scope: 'section' | 'donors' | 'segments', schema: z.ZodType<T>, schemaName: string): Promise<T> {
    const { system, prompt } = buildGeneratePrompt({ scope, ...promptBase })
    const startedAt = Date.now()
    try {
      const { object, responseModel } = await generateStructuredOutput(aiConfig, {
        system,
        prompt,
        schema,
        schemaName,
        schemaDescription: `Search map: ${scope}`,
        temperature: 0.3,
        disableThinking: true,
      })
      console.info(`[search-map:generate] ${scope} ok in ${Date.now() - startedAt}ms (model ${responseModel ?? aiConfig.model})`)
      return object
    } catch (err) {
      console.error(`[search-map:generate] ${scope} failed after ${Date.now() - startedAt}ms:`, (err as any)?.message ?? err)
      throw err
    }
  }

  // ── Какие части генерируем ───────────────────────────────────────
  const wantSections = body.scope === 'full' || body.scope === 'section' || body.scope === 'summary'
  const wantDonors = body.scope === 'full' || body.scope === 'donors'
  const wantSegments = body.scope === 'full' || body.scope === 'segments' || body.scope === 'query_string'

  const [secRes, donRes, segRes] = await Promise.allSettled([
    wantSections ? callAi('section', sectionsOutputSchema, 'searchMapSections') : Promise.resolve(null),
    wantDonors ? callAi('donors', donorsOutputSchema, 'searchMapDonors') : Promise.resolve(null),
    wantSegments ? callAi('segments', segmentsOutputSchema, 'searchMapSegments') : Promise.resolve(null),
  ])

  const warnings: string[] = []
  const failures: string[] = []
  const pick = <T>(r: PromiseSettledResult<T | null>, label: string): T | null => {
    if (r.status === 'fulfilled') return r.value
    failures.push(`${label}: ${errorText(r.reason)}`)
    return null
  }
  const sectionsOut = pick<SectionsOut>(secRes, 'Секции')
  const donorsOut = pick<DonorsOut>(donRes, 'Доноры')
  const segmentsOut = pick<SegmentsOut>(segRes, 'Сегменты')

  const requested = [wantSections, wantDonors, wantSegments].filter(Boolean).length
  if (failures.length === requested) {
    throw createError({
      statusCode: 502,
      statusMessage: `Генерация не удалась: ${failures.join('; ')}`,
      data: { failures },
    })
  }
  warnings.push(...failures.map(f => `Часть не сгенерирована — ${f}`))

  // ── Summary ─────────────────────────────────────────────────────
  if (sectionsOut?.summary && (mode === 'append' || !map.summary)) {
    await db.update(jobSearchMap).set({ summary: sectionsOut.summary.trim(), updatedAt: new Date() })
      .where(eq(jobSearchMap.id, map.id))
  }

  // ── Sections / items ────────────────────────────────────────────
  let itemsAdded = 0
  let createdSections = 0
  if (sectionsOut?.sections?.length) {
    const sectionByType = new Map(existingSections.map(s => [s.sectionType as string, s]))
    for (const aiSection of sectionsOut.sections) {
      const sectionType = normalizeSectionType(aiSection.sectionType)
      if (!sectionType) {
        warnings.push(`Секция «${aiSection.sectionType}» не распознана — пропущена`)
        continue
      }
      let section = sectionByType.get(sectionType)
      if (!section) {
        const [created] = await db.insert(jobSearchMapSection).values({
          mapId: map.id,
          organizationId: orgId as string,
          sectionType,
          title: SECTION_TITLES[sectionType],
          displayOrder: existingSections.length + createdSections++,
        }).returning()
        if (!created) continue
        section = created
        sectionByType.set(sectionType, created)
      }

      const existing = await db.select({ normalizedValue: jobSearchMapItem.normalizedValue })
        .from(jobSearchMapItem).where(eq(jobSearchMapItem.sectionId, section.id))
      if (mode === 'fill_empty' && existing.length) continue

      const seen = new Set(existing.map(e => e.normalizedValue))
      let order = existing.length
      for (const item of aiSection.items) {
        const value = String(item.value ?? '').trim().slice(0, 500)
        const normalizedValue = normalizeItemValue(value)
        if (!normalizedValue || seen.has(normalizedValue)) continue
        seen.add(normalizedValue)
        await db.insert(jobSearchMapItem).values({
          mapId: map.id, sectionId: section.id, organizationId: orgId as string,
          value, normalizedValue, note: item.note?.trim() || null, origin: 'ai', displayOrder: order++,
        })
        itemsAdded++
      }
    }
  }

  // ── Donors ──────────────────────────────────────────────────────
  let donorsAdded = 0
  if (donorsOut?.donors?.length) {
    const existingDonors = await db.select().from(jobSearchMapDonor).where(eq(jobSearchMapDonor.mapId, map.id))
    const presentCompanyIds = new Set(existingDonors.map(d => d.donorCompanyId))
    let order = existingDonors.length
    for (const d of donorsOut.donors) {
      const name = String(d.name ?? '').trim().slice(0, 160)
      if (!name) continue
      const normalized = normalizeCompanyName(name)
      let [company] = await db.select().from(donorCompany)
        .where(and(eq(donorCompany.organizationId, orgId), eq(donorCompany.normalizedName, normalized))).limit(1)

      if (!company) {
        [company] = await db.insert(donorCompany).values({
          organizationId: orgId, canonicalName: name, normalizedName: normalized,
          industry: d.industry?.trim() || null, techStack: cleanList(d.techStack, 30),
          createdById: userId, createdFromJobId: jobId,
        }).returning()
      }
      if (!company || presentCompanyIds.has(company.id)) continue
      presentCompanyIds.add(company.id)

      await db.insert(jobSearchMapDonor).values({
        organizationId: orgId, mapId: map.id, donorCompanyId: company.id,
        layer: normalizeLayer(d.layer) ?? 'custom',
        priority: normalizePriority(d.priority),
        rationale: d.rationale?.trim() || null,
        origin: 'ai', displayOrder: order++,
      })
      donorsAdded++
    }
  }

  // ── Segments ────────────────────────────────────────────────────
  let segmentsAdded = 0
  if (segmentsOut?.segments?.length) {
    const existingSegments = await db.select({ name: jobSearchMapSegment.name }).from(jobSearchMapSegment)
      .where(eq(jobSearchMapSegment.mapId, map.id))
    const seenNames = new Set(existingSegments.map(s => s.name.toLowerCase().trim()))
    let order = existingSegments.length
    for (const s of segmentsOut.segments) {
      const name = String(s.name ?? '').trim().slice(0, 200)
      const titles = cleanList(s.titles, 10)
      const keywords = cleanList(s.keywords, 20)
      const geo = cleanList(s.geo, 5)
      const donorLayer = normalizeLayer(s.donorLayer)
      const channel = resolveChannel(s.channelCode, activeChannels)

      if (!channel) {
        warnings.push(`Канал «${s.channelCode ?? '—'}» не найден — сегмент «${name || '?'}» пропущен`)
        continue
      }
      if (!name || seenNames.has(name.toLowerCase())) continue
      if (!titles.length && !keywords.length && !geo.length && !donorLayer) continue
      seenNames.add(name.toLowerCase())

      const queryString = s.queryString?.trim() || null
      await db.insert(jobSearchMapSegment).values({
        organizationId: orgId, mapId: map.id,
        name, donorLayer,
        titles, keywords, geo,
        channelId: channel.id,
        queryString,
        queryUrl: buildQueryUrl({ queryString, urlTemplate: channel.urlTemplate, targetSite: channel.targetSite, titles, geo }),
        priority: normalizePriority(s.priority, normalizePriority(channel.defaultPriority)),
        rationale: s.rationale?.trim() || null,
        origin: 'ai', displayOrder: order++,
      })
      segmentsAdded++
    }
  }

  return {
    scope: body.scope,
    model: aiConfig.model,
    summary: sectionsOut?.summary ?? null,
    itemsAdded,
    donorsAdded,
    segmentsAdded,
    warnings,
  }
})
