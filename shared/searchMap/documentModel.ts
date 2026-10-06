/**
 * Документ-модель карты поиска — единое содержимое для экрана (SearchMapDocumentView),
 * печати/PDF (exportPdf) и Markdown (exportMarkdown). docs/tz-search-map-v2.md §3.2.
 *
 * Принцип: разметка у экрана и у PDF своя, а НАБОР и ПОРЯДОК блоков, подписи, сортировки
 * и вычисляемые строки — отсюда. Если что-то появилось в PDF, но не на экране (или наоборот),
 * это баг этого файла, а не двух шаблонов.
 */
import {
  LAYER_ORDER, LAYER_HINTS, PRIORITY_ORDER, HYPOTHESIS_STATUS_ORDER,
  layerLabel, priorityLabel, statusLabel, VERSION_TRIGGER_LABELS,
} from './labels'

// ─── Вход: то, что отдаёт GET /api/jobs/[id]/search-map (+ версии) ──────────

export interface DocSectionInput {
  id?: string
  sectionType: string
  title: string
  guidance?: string | null
  isRequired?: boolean
  displayOrder?: number
  items: { id?: string; value: string; note?: string | null; origin?: string }[]
}

export interface DocDonorInput {
  donor: {
    id?: string
    layer: string
    priority: string
    hypothesisStatus: string
    rationale?: string | null
    resultNote?: string | null
    origin?: string
    displayOrder?: number
  }
  company: { id?: string; canonicalName: string; industry?: string | null; tags?: string[] | null }
}

export interface DocSegmentInput {
  segment: {
    id?: string
    name: string
    donorLayer?: string | null
    titles?: string[] | null
    keywords?: string[] | null
    geo?: string[] | null
    queryString?: string | null
    queryUrl?: string | null
    priority: string
    poolEstimate?: number | null
    responseLikelihood?: number | null
    accessDifficulty?: number | null
    hypothesisStatus: string
    rationale?: string | null
    resultNote?: string | null
    origin?: string
    isArchived?: boolean
    displayOrder?: number
  }
  channel?: { id?: string; code?: string | null; name?: string | null } | null
  hhSearchesCount?: number
}

export interface DocVersionInput {
  id?: string
  versionNo: number
  label: string
  trigger?: string | null
  comment?: string | null
  diffSummary?: unknown
  createdAt: string | Date
}

export interface SearchMapDocumentInput {
  jobTitle: string
  map: {
    status?: string | null
    summary?: string | null
    currentVersionNo?: number | null
    lastGeneratedAt?: string | Date | null
    lastGenerationModel?: string | null
    updatedAt?: string | Date | null
  }
  sections: DocSectionInput[]
  donors: DocDonorInput[]
  segments: DocSegmentInput[]
  versions?: DocVersionInput[]
  staleSources?: string[]
}

// ─── Выход: модель документа ────────────────────────────────────────────────

export interface DocFacts {
  hypothesesTotal: number
  hypothesesByStatus: Record<'working' | 'in_progress' | 'untested' | 'rejected', number>
  donorsTotal: number
  donorsWorking: number
  hhSearchesTotal: number
  requiredSectionsFilled: number
  requiredSectionsTotal: number
  aiItemsShare: number | null
  lastGeneratedAt: Date | null
  lastGenerationModel: string | null
  versionLabel: string | null
}

export interface DocHypothesis {
  id?: string
  name: string
  layer: string | null
  layerLabel: string
  titles: string[]
  keywords: string[]
  geo: string[]
  channelName: string
  channelCode: string | null
  priority: string
  priorityLabel: string
  status: string
  statusLabel: string
  scores: { pool: number | null; response: number | null; access: number | null }
  queryString: string | null
  queryUrl: string | null
  rationale: string | null
  resultNote: string | null
  hhSearchesCount: number
  isAi: boolean
  isArchived: boolean
  /** Вторая строка в таблице: «тайтлы · гео». */
  subtitle: string
}

export interface DocDonorLayer {
  key: string
  label: string
  hint: string
  donors: {
    id?: string
    name: string
    industry: string | null
    priority: string
    priorityLabel: string
    status: string
    statusLabel: string
    rationale: string | null
    resultNote: string | null
    isAi: boolean
  }[]
}

export interface DocSection {
  id?: string
  sectionType: string
  title: string
  guidance: string | null
  isRequired: boolean
  items: { id?: string; value: string; note: string | null; isAi: boolean }[]
}

export interface DocVersion {
  id?: string
  versionNo: number
  label: string
  triggerLabel: string
  comment: string | null
  diffLine: string | null
  createdAt: Date
  isCurrent: boolean
}

export interface SearchMapDocument {
  title: string
  jobTitle: string
  summary: string | null
  facts: DocFacts
  staleSources: string[]
  sections: DocSection[]
  donorLayers: DocDonorLayer[]
  hypotheses: DocHypothesis[]
  queries: { name: string; channelName: string; queryString: string; queryUrl: string | null }[]
  versions: DocVersion[]
}

// ─── Сборка ────────────────────────────────────────────────────────────────

function toDate(v: string | Date | null | undefined): Date | null {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

export function sortHypotheses<T extends { priority: string; hypothesisStatus: string; displayOrder?: number }>(list: T[]): T[] {
  return [...list].sort((a, b) =>
    (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9)
    || (HYPOTHESIS_STATUS_ORDER[a.hypothesisStatus] ?? 9) - (HYPOTHESIS_STATUS_ORDER[b.hypothesisStatus] ?? 9)
    || (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
}

export function hypothesisSubtitle(seg: { titles?: string[] | null; geo?: string[] | null }): string {
  const allTitles = seg.titles ?? []
  const allGeo = seg.geo ?? []
  const titles = allTitles.slice(0, 3).join(', ') + (allTitles.length > 3 ? ` +${allTitles.length - 3}` : '')
  const geo = allGeo.slice(0, 2).join(', ') + (allGeo.length > 2 ? ` +${allGeo.length - 2}` : '')
  return [titles, geo].filter(Boolean).join(' · ')
}

/**
 * Короткая строка изменений версии из diffSummary.
 * Формат — результат server/utils/searchMap/diffSnapshots.ts:
 * { sections: [{title, added[], removed[]}], donors: {added[], removed[], changed[]}, segments: {…} }.
 */
export function versionDiffLine(diff: unknown): string | null {
  if (!diff || typeof diff !== 'object') return null
  const d = diff as {
    sections?: { title: string; added?: unknown[]; removed?: unknown[] }[]
    donors?: { added?: unknown[]; removed?: unknown[]; changed?: unknown[] }
    segments?: { added?: unknown[]; removed?: unknown[]; changed?: unknown[] }
  }
  const len = (v: unknown) => (Array.isArray(v) ? v.length : 0)
  const parts: string[] = []

  const itemsAdded = (d.sections ?? []).reduce((n, s) => n + len(s.added), 0)
  const itemsRemoved = (d.sections ?? []).reduce((n, s) => n + len(s.removed), 0)
  if (itemsAdded) parts.push(`+${itemsAdded} ${plural(itemsAdded, 'пункт', 'пункта', 'пунктов')}`)
  if (itemsRemoved) parts.push(`−${itemsRemoved} ${plural(itemsRemoved, 'пункт', 'пункта', 'пунктов')}`)

  const dA = len(d.donors?.added); const dR = len(d.donors?.removed); const dC = len(d.donors?.changed)
  if (dA) parts.push(`+${dA} ${plural(dA, 'донор', 'донора', 'доноров')}`)
  if (dR) parts.push(`−${dR} ${plural(dR, 'донор', 'донора', 'доноров')}`)
  if (dC) parts.push(`${dC} ${plural(dC, 'донор изменён', 'донора изменены', 'доноров изменены')}`)

  const sA = len(d.segments?.added); const sR = len(d.segments?.removed); const sC = len(d.segments?.changed)
  if (sA) parts.push(`+${sA} ${plural(sA, 'гипотеза', 'гипотезы', 'гипотез')}`)
  if (sR) parts.push(`−${sR} ${plural(sR, 'гипотеза', 'гипотезы', 'гипотез')}`)
  if (sC) parts.push(`${sC} ${plural(sC, 'гипотеза изменена', 'гипотезы изменены', 'гипотез изменены')}`)

  return parts.length ? parts.join(' · ') : null
}

export function buildSearchMapDocument(input: SearchMapDocumentInput): SearchMapDocument {
  const activeSegments = input.segments.filter(s => !s.segment.isArchived)

  const byStatus = { working: 0, in_progress: 0, untested: 0, rejected: 0 }
  for (const s of activeSegments) {
    const st = s.segment.hypothesisStatus as keyof typeof byStatus
    if (st in byStatus) byStatus[st]++
  }

  const requiredSections = input.sections.filter(s => s.isRequired)
  const allItems = input.sections.flatMap(s => s.items)
  const aiItems = allItems.filter(i => i.origin === 'ai').length

  const facts: DocFacts = {
    hypothesesTotal: activeSegments.length,
    hypothesesByStatus: byStatus,
    donorsTotal: input.donors.length,
    donorsWorking: input.donors.filter(d => d.donor.hypothesisStatus === 'working').length,
    hhSearchesTotal: activeSegments.reduce((n, s) => n + (s.hhSearchesCount ?? 0), 0),
    requiredSectionsFilled: requiredSections.filter(s => s.items.length > 0).length,
    requiredSectionsTotal: requiredSections.length,
    aiItemsShare: allItems.length ? Math.round((aiItems / allItems.length) * 100) : null,
    lastGeneratedAt: toDate(input.map.lastGeneratedAt),
    lastGenerationModel: input.map.lastGenerationModel ?? null,
    versionLabel: input.map.currentVersionNo ? `v${input.map.currentVersionNo}` : null,
  }

  const sections: DocSection[] = [...input.sections]
    .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
    .map(s => ({
      id: s.id,
      sectionType: s.sectionType,
      title: s.title,
      guidance: s.guidance ?? null,
      isRequired: !!s.isRequired,
      items: s.items.map(i => ({ id: i.id, value: i.value, note: i.note ?? null, isAi: i.origin === 'ai' })),
    }))

  const donorLayers: DocDonorLayer[] = LAYER_ORDER.map(key => ({
    key,
    label: layerLabel(key),
    hint: LAYER_HINTS[key] ?? '',
    donors: input.donors
      .filter(d => d.donor.layer === key)
      .sort((a, b) =>
        (PRIORITY_ORDER[a.donor.priority] ?? 9) - (PRIORITY_ORDER[b.donor.priority] ?? 9)
        || (HYPOTHESIS_STATUS_ORDER[a.donor.hypothesisStatus] ?? 9) - (HYPOTHESIS_STATUS_ORDER[b.donor.hypothesisStatus] ?? 9)
        || (a.donor.displayOrder ?? 0) - (b.donor.displayOrder ?? 0))
      .map(d => ({
        id: d.donor.id,
        name: d.company.canonicalName,
        industry: d.company.industry ?? null,
        priority: d.donor.priority,
        priorityLabel: priorityLabel(d.donor.priority),
        status: d.donor.hypothesisStatus,
        statusLabel: statusLabel(d.donor.hypothesisStatus),
        rationale: d.donor.rationale ?? null,
        resultNote: d.donor.resultNote ?? null,
        isAi: d.donor.origin === 'ai',
      })),
  })).filter(l => l.donors.length > 0)

  const hypotheses: DocHypothesis[] = sortHypotheses(activeSegments.map(s => ({ ...s.segment, _row: s })))
    .map((seg) => {
      const row = (seg as typeof seg & { _row: DocSegmentInput })._row
      return {
        id: seg.id,
        name: seg.name,
        layer: seg.donorLayer ?? null,
        layerLabel: layerLabel(seg.donorLayer),
        titles: seg.titles ?? [],
        keywords: seg.keywords ?? [],
        geo: seg.geo ?? [],
        channelName: row.channel?.name ?? '—',
        channelCode: row.channel?.code ?? null,
        priority: seg.priority,
        priorityLabel: priorityLabel(seg.priority),
        status: seg.hypothesisStatus,
        statusLabel: statusLabel(seg.hypothesisStatus),
        scores: {
          pool: seg.poolEstimate ?? null,
          response: seg.responseLikelihood ?? null,
          access: seg.accessDifficulty ?? null,
        },
        queryString: seg.queryString ?? null,
        queryUrl: seg.queryUrl ?? null,
        rationale: seg.rationale ?? null,
        resultNote: seg.resultNote ?? null,
        hhSearchesCount: row.hhSearchesCount ?? 0,
        isAi: seg.origin === 'ai',
        isArchived: !!seg.isArchived,
        subtitle: hypothesisSubtitle(seg),
      }
    })

  const queries = hypotheses
    .filter(h => h.queryString)
    .map(h => ({ name: h.name, channelName: h.channelName, queryString: h.queryString!, queryUrl: h.queryUrl }))

  const currentNo = input.map.currentVersionNo ?? 0
  const versions: DocVersion[] = [...(input.versions ?? [])]
    .sort((a, b) => b.versionNo - a.versionNo)
    .map(v => ({
      id: v.id,
      versionNo: v.versionNo,
      label: v.label,
      triggerLabel: v.trigger ? (VERSION_TRIGGER_LABELS[v.trigger] ?? v.trigger) : '',
      comment: v.comment ?? null,
      diffLine: versionDiffLine(v.diffSummary),
      createdAt: toDate(v.createdAt) ?? new Date(0),
      isCurrent: v.versionNo === currentNo,
    }))

  return {
    title: `Карта поиска: ${input.jobTitle}`,
    jobTitle: input.jobTitle,
    summary: input.map.summary?.trim() || null,
    facts,
    staleSources: input.staleSources ?? [],
    sections,
    donorLayers,
    hypotheses,
    queries,
    versions,
  }
}

/** Строка фактов под вердиктом: «7 гипотез · 2 работают · 11 доноров · 3 hh-поиска». */
export function factsLine(f: DocFacts): string {
  const parts: string[] = []
  parts.push(`${f.hypothesesTotal} ${plural(f.hypothesesTotal, 'гипотеза', 'гипотезы', 'гипотез')}`)
  if (f.hypothesesByStatus.working) parts.push(`${f.hypothesesByStatus.working} ${plural(f.hypothesesByStatus.working, 'работает', 'работают', 'работают')}`)
  if (f.hypothesesByStatus.untested) parts.push(`${f.hypothesesByStatus.untested} не ${plural(f.hypothesesByStatus.untested, 'проверена', 'проверены', 'проверены')}`)
  parts.push(`${f.donorsTotal} ${plural(f.donorsTotal, 'донор', 'донора', 'доноров')}`)
  if (f.hhSearchesTotal) parts.push(`${f.hhSearchesTotal} hh-${plural(f.hhSearchesTotal, 'поиск', 'поиска', 'поисков')}`)
  if (f.requiredSectionsTotal) parts.push(`обязательные секции ${f.requiredSectionsFilled}/${f.requiredSectionsTotal}`)
  return parts.join(' · ')
}

export function plural(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(n) % 100
  const last = abs % 10
  if (abs > 10 && abs < 20) return many
  if (last > 1 && last < 5) return few
  if (last === 1) return one
  return many
}
