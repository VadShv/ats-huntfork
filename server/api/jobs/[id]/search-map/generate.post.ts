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
import { segmentSemanticKey } from '../../../../utils/searchMap/generationContext'
import {
  SECTION_TITLES, cleanList, normalizeItemValue, normalizeLayer, normalizePriority,
  normalizeSectionType, resolveChannel,
} from '../../../../utils/searchMap/normalizeAiVocab'
import { buildQueryString, usableExclusions } from '../../../../../shared/searchMap/queryBuilder'
import { loadAiConfig } from '../../../../utils/ai/loadConfig'
import { generateStructuredOutput, type SupportedProvider } from '../../../../utils/ai/provider'

/**
 * POST /api/jobs/[id]/search-map/generate — AI-генерация содержимого карты.
 * Право: searchMap:edit. docs/tz-search-map-v2.md §2a (контекст), §3.5 (точечное дополнение), §6.2 (модели).
 *
 * Устойчивость:
 *  1. «full» = ТРИ параллельных небольших вызова (секции / доноры / гипотезы): быстрее, падают независимо.
 *  2. Схема ответа принимает строки, а не z.enum — модели пишут "P1", "hh.ru", "key_skills".
 *     Нормализация → enum'ы БД (normalizeAiVocab.ts); непонятное пропускается с warning.
 *  3. Частичный успех: упала одна часть — остальные применяются, ошибка в warnings; упали все — 502 с причиной.
 *
 * Контракт по частям:
 *  - sections / donors / segments / full — пишут в БД (append | fill_empty), возвращают счётчики.
 *  - summary — НЕ пишет: возвращает { summary, previous }, клиент показывает «было/стало» и сохраняет PATCH'ем.
 *  - query_string — НЕ пишет: возвращает { queryString, previous, explanation } для одной гипотезы.
 *
 * Модели: секции и вердикт — назначение `structuring` (дешёвая, быстрая; fallback на analysis в loadAiConfig),
 * доноры, гипотезы и запрос — `analysis` (нужны знания рынка).
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

const summaryOutputSchema = z.object({ summary: z.string() })

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
    priority: z.string().nullish(),
    rationale: z.string().nullish(),
  })).max(10).default([]),
})

const queryOutputSchema = z.object({
  queryString: z.string(),
  explanation: z.string().nullish(),
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
  const orgId = session.session.activeOrganizationId as string
  const userId = session.user.id
  const { id: jobId } = await getValidatedRouterParams(event, z.object({ id: z.string().min(1) }).parse)
  await requireJobInScope(event, jobId)
  const body = await readValidatedBody(event, generateInputSchema.parse)
  const mode = body.mode ?? 'append'
  const limit = body.limit ?? (body.count ? Math.min(body.count, 10) : undefined)

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
  const channelById = new Map(activeChannels.map(c => [c.id, c]))

  const existingDonorRows = await db.select({ name: donorCompany.canonicalName, layer: jobSearchMapDonor.layer })
    .from(jobSearchMapDonor)
    .innerJoin(donorCompany, eq(donorCompany.id, jobSearchMapDonor.donorCompanyId))
    .where(eq(jobSearchMapDonor.mapId, map.id))

  const existingSegmentRows = await db.select().from(jobSearchMapSegment)
    .where(eq(jobSearchMapSegment.mapId, map.id)).orderBy(asc(jobSearchMapSegment.displayOrder))
  const existingSegments = existingSegmentRows
    .filter(s => !s.isArchived)
    .map(s => ({
      name: s.name,
      donorLayer: s.donorLayer,
      channelCode: s.channelId ? channelById.get(s.channelId)?.code ?? null : null,
      titles: s.titles,
    }))

  // Исключения из секции exclusions — для детерминированной сборки запроса (NOT …).
  const exclusionSection = existingSections.find(s => s.sectionType === 'exclusions')
  const exclusions = usableExclusions(
    exclusionSection ? existingItems.filter(i => i.sectionId === exclusionSection.id).map(i => i.value) : [],
  )

  const promptBase = {
    jobTitle: j.title,
    brief: brief ?? null,
    criteria,
    description: j.description,
    existingSections: existingSections.map(s => ({
      title: s.title,
      items: existingItems.filter(i => i.sectionId === s.id).map(i => i.value),
    })),
    existingDonors: existingDonorRows,
    existingSegments,
    channels: activeChannels.map(c => ({ code: c.code, name: c.name, queryLanguageHint: c.queryLanguageHint })),
    hint: body.hint,
    limit,
  }

  // ── Модели по назначению (ТЗ §6.2) ────────────────────────────────
  const [structuringRow, analysisRow] = await Promise.all([
    loadAiConfig(orgId, { purpose: 'structuring' }),
    loadAiConfig(orgId, { purpose: 'analysis' }),
  ])
  const structuringCfg = { ...structuringRow, provider: structuringRow.provider as SupportedProvider }
  const analysisCfg = { ...analysisRow, provider: analysisRow.provider as SupportedProvider }

  const runs: { part: string; model: string; promptChars: number; promptTokens: number; completionTokens: number; durationMs: number; status: 'ok' | 'error'; error?: string }[] = []

  async function callAi<T>(
    part: 'sections' | 'donors' | 'segments' | 'summary' | 'query_string',
    schema: z.ZodType<T>,
    schemaName: string,
    extra: Partial<Parameters<typeof buildGeneratePrompt>[0]> = {},
  ): Promise<T> {
    const cfg = part === 'sections' || part === 'summary' ? structuringCfg : analysisCfg
    const { system, prompt } = buildGeneratePrompt({ part, ...promptBase, ...extra })
    const startedAt = Date.now()
    try {
      const { object, usage, responseModel } = await generateStructuredOutput(cfg, {
        system,
        prompt,
        schema,
        schemaName,
        schemaDescription: `Search map: ${part}`,
        temperature: part === 'query_string' ? 0.1 : 0.3,
        disableThinking: true,
      })
      const durationMs = Date.now() - startedAt
      runs.push({ part, model: responseModel ?? cfg.model, promptChars: system.length + prompt.length, promptTokens: usage.promptTokens, completionTokens: usage.completionTokens, durationMs, status: 'ok' })
      console.info(`[search-map:generate] ${part} ok in ${durationMs}ms · model ${responseModel ?? cfg.model} · prompt ${system.length + prompt.length} chars · tokens ${usage.promptTokens}+${usage.completionTokens}`)
      return object
    } catch (err) {
      const durationMs = Date.now() - startedAt
      runs.push({ part, model: cfg.model, promptChars: system.length + prompt.length, promptTokens: 0, completionTokens: 0, durationMs, status: 'error', error: errorText(err) })
      console.error(`[search-map:generate] ${part} failed after ${durationMs}ms · model ${cfg.model} · prompt ${system.length + prompt.length} chars:`, (err as any)?.message ?? err)
      throw err
    }
  }

  // ── Вердикт: предложение без сохранения ──────────────────────────
  if (body.scope === 'summary') {
    try {
      const out = await callAi('summary', summaryOutputSchema, 'searchMapSummary', { currentSummary: map.summary })
      return { scope: 'summary' as const, summary: out.summary.trim(), previous: map.summary ?? null, runs, warnings: [] as string[] }
    } catch (err) {
      throw createError({ statusCode: 502, statusMessage: `Не удалось сформировать вердикт: ${errorText(err)}` })
    }
  }

  // ── Запрос одной гипотезы: предложение без сохранения ────────────
  if (body.scope === 'query_string') {
    const target = existingSegmentRows.find(s => s.id === body.segmentId)
    if (!target) throw createError({ statusCode: 404, statusMessage: 'Гипотеза не найдена' })
    const ch = target.channelId ? channelById.get(target.channelId) : undefined
    try {
      const out = await callAi('query_string', queryOutputSchema, 'searchMapQuery', {
        targetSegment: {
          name: target.name, titles: target.titles, keywords: target.keywords, geo: target.geo,
          channelCode: ch?.code ?? null, channelName: ch?.name ?? null, queryLanguageHint: ch?.queryLanguageHint ?? null,
          queryString: target.queryString,
        },
      })
      const queryString = out.queryString.trim().replace(/^site:\S+\s+/i, '')
      return {
        scope: 'query_string' as const, segmentId: target.id,
        queryString, previous: target.queryString ?? null, explanation: out.explanation?.trim() || null,
        runs, warnings: [] as string[],
      }
    } catch (err) {
      throw createError({ statusCode: 502, statusMessage: `Не удалось переписать запрос: ${errorText(err)}` })
    }
  }

  // ── Какие части генерируем ───────────────────────────────────────
  const wantSections = body.scope === 'full' || body.scope === 'section'
  const wantDonors = body.scope === 'full' || body.scope === 'donors'
  const wantSegments = body.scope === 'full' || body.scope === 'segments'

  // Точечное дополнение: конкретная секция (scope section + sectionId) или слой доноров (donors + layer).
  const targetSection = body.scope === 'section' && body.sectionId
    ? existingSections.find(s => s.id === body.sectionId) ?? null
    : null
  if (body.scope === 'section' && body.sectionId && !targetSection) {
    throw createError({ statusCode: 404, statusMessage: 'Секция не найдена' })
  }

  const [secRes, donRes, segRes] = await Promise.allSettled([
    wantSections
      ? callAi('sections', sectionsOutputSchema, 'searchMapSections', {
          targetSection: targetSection ? { sectionType: targetSection.sectionType, title: targetSection.title, guidance: targetSection.guidance } : null,
        })
      : Promise.resolve(null),
    wantDonors ? callAi('donors', donorsOutputSchema, 'searchMapDonors', { targetLayer: body.layer ?? null }) : Promise.resolve(null),
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
  const segmentsOut = pick<SegmentsOut>(segRes, 'Гипотезы')

  const requested = [wantSections, wantDonors, wantSegments].filter(Boolean).length
  if (failures.length === requested) {
    throw createError({
      statusCode: 502,
      statusMessage: `Генерация не удалась: ${failures.join('; ')}`,
      data: { failures, runs },
    })
  }
  warnings.push(...failures.map(f => `Часть не сгенерирована — ${f}`))

  // ── Summary (только если пусто — вердикт с текстом не перезаписываем молча) ──
  let summaryUpdated = false
  if (sectionsOut?.summary && !map.summary?.trim()) {
    await db.update(jobSearchMap).set({ summary: sectionsOut.summary.trim(), updatedAt: new Date() })
      .where(eq(jobSearchMap.id, map.id))
    summaryUpdated = true
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
      // Точечное дополнение одной секции: всё лишнее от модели отбрасываем молча.
      if (targetSection && sectionType !== targetSection.sectionType) continue
      let section = sectionByType.get(sectionType)
      if (!section) {
        const [created] = await db.insert(jobSearchMapSection).values({
          mapId: map.id,
          organizationId: orgId,
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
      const itemsToAdd = targetSection && limit ? aiSection.items.slice(0, limit) : aiSection.items
      for (const item of itemsToAdd) {
        const value = String(item.value ?? '').trim().slice(0, 500)
        const normalizedValue = normalizeItemValue(value)
        if (!normalizedValue || seen.has(normalizedValue)) continue
        seen.add(normalizedValue)
        await db.insert(jobSearchMapItem).values({
          mapId: map.id, sectionId: section.id, organizationId: orgId,
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
    const donorsToAdd = limit ? donorsOut.donors.slice(0, limit) : donorsOut.donors
    for (const d of donorsToAdd) {
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
        layer: body.layer ?? normalizeLayer(d.layer) ?? 'custom',
        priority: normalizePriority(d.priority),
        rationale: d.rationale?.trim() || null,
        origin: 'ai', displayOrder: order++,
      })
      donorsAdded++
    }
  }

  // ── Segments (гипотезы) ─────────────────────────────────────────
  let segmentsAdded = 0
  let segmentsSkippedAsDuplicates = 0
  if (segmentsOut?.segments?.length) {
    const seenNames = new Set(existingSegmentRows.map(s => s.name.toLowerCase().trim()))
    const seenKeys = new Set(existingSegments.map(segmentSemanticKey))
    let order = existingSegmentRows.length
    const segmentsToAdd = limit ? segmentsOut.segments.slice(0, limit) : segmentsOut.segments
    for (const s of segmentsToAdd) {
      const name = String(s.name ?? '').trim().slice(0, 200)
      const titles = cleanList(s.titles, 10)
      const keywords = cleanList(s.keywords, 20)
      const geo = cleanList(s.geo, 5)
      const donorLayer = normalizeLayer(s.donorLayer)
      const channel = resolveChannel(s.channelCode, activeChannels)

      if (!channel) {
        warnings.push(`Канал «${s.channelCode ?? '—'}» не найден — гипотеза «${name || '?'}» пропущена`)
        continue
      }
      if (!name) continue
      if (!titles.length && !keywords.length && !geo.length && !donorLayer) continue

      const semanticKey = segmentSemanticKey({ name, donorLayer, channelCode: channel.code, titles })
      if (seenNames.has(name.toLowerCase()) || (titles.length && seenKeys.has(semanticKey))) {
        segmentsSkippedAsDuplicates++
        continue
      }
      seenNames.add(name.toLowerCase())
      seenKeys.add(semanticKey)

      // Строка запроса — только кодом (ТЗ §6.3): модель её не возвращает, шаблон зависит от канала,
      // результат совпадает с кнопкой «Собрать» в дровере.
      const queryString = buildQueryString({ titles, keywords, geo }, channel, exclusions) || null
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
  if (segmentsSkippedAsDuplicates) {
    warnings.push(`${segmentsSkippedAsDuplicates} гипотез(ы) совпали с существующими по слою, каналу и тайтлам — пропущены`)
  }

  if (itemsAdded || donorsAdded || segmentsAdded || summaryUpdated) {
    await db.update(jobSearchMap).set({
      lastGeneratedAt: new Date(),
      lastGenerationModel: runs.find(r => r.status === 'ok')?.model ?? analysisCfg.model,
      updatedAt: new Date(),
    }).where(eq(jobSearchMap.id, map.id))
  }

  return {
    scope: body.scope,
    model: analysisCfg.model,
    summary: sectionsOut?.summary ?? null,
    summaryUpdated,
    itemsAdded,
    donorsAdded,
    segmentsAdded,
    warnings,
    runs,
  }
})
