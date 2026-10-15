/**
 * Схемы ответов модели для генерации карты поиска (POST /search-map/generate).
 * docs/tz-search-map-v2.md §6.2.
 *
 * Принцип: схема терпима к форме, строга к смыслу. Модели (GLM, Qwen, YandexGPT)
 * регулярно отклоняются от JSON-схемы, особенно если провайдер её не передал:
 *   - пункты секций приходят строками вместо { value, note };
 *   - секции приходят объектом { title_synonyms: [...] } вместо массива;
 *   - корневой ключ переименован (hypotheses вместо segments, companies вместо donors)
 *     или обёрнут ещё одним уровнем ({ result: {...} }, { data: {...} });
 *   - вместо объекта приходит голый массив элементов.
 * Все эти формы приводятся к канонической здесь (z.preprocess), а не падают
 * с «модель вернула ответ не по схеме». Словарь значений (enum'ы, каналы)
 * нормализуется отдельно — normalizeAiVocab.ts.
 */
import { z } from 'zod'

type Dict = Record<string, unknown>

const isDict = (v: unknown): v is Dict => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Снять одну «лишнюю» обёртку: { result: {...} }, { data: {...} }, { response: {...} }, { output: {...} }. */
function unwrapEnvelope(raw: unknown): unknown {
  if (!isDict(raw)) return raw
  for (const key of ['result', 'data', 'response', 'output', 'answer']) {
    const inner = raw[key]
    if (isDict(inner) && Object.keys(raw).length <= 2) return inner
  }
  return raw
}

/** Найти массив по основному ключу или одному из синонимов (без учёта регистра). */
function pickArray(raw: Dict, keys: string[]): unknown[] | undefined {
  const lower = new Map(Object.keys(raw).map(k => [k.toLowerCase(), k]))
  for (const key of keys) {
    const actual = lower.get(key.toLowerCase())
    if (actual !== undefined && Array.isArray(raw[actual])) return raw[actual] as unknown[]
  }
  return undefined
}

function pickString(raw: Dict, keys: string[]): string | undefined {
  const lower = new Map(Object.keys(raw).map(k => [k.toLowerCase(), k]))
  for (const key of keys) {
    const actual = lower.get(key.toLowerCase())
    if (actual !== undefined && typeof raw[actual] === 'string') return raw[actual] as string
  }
  return undefined
}

// ─── Элементы ───────────────────────────────────────────────────────

/** Пункт секции: объект { value, note } или просто строка. */
const itemSchema = z.preprocess((v) => {
  if (typeof v === 'string' || typeof v === 'number') return { value: String(v) }
  if (isDict(v)) {
    const value = v.value ?? v.text ?? v.name ?? v.title ?? v.item ?? v.keyword
    const note = v.note ?? v.comment ?? v.hint ?? v.reason ?? v.rationale
    return { value: value == null ? '' : String(value), note: note == null ? null : String(note) }
  }
  return v
}, z.object({ value: z.string(), note: z.string().nullish() }))

const SECTION_ALIASES: Record<string, string> = {
  synonyms: 'title_synonyms', titles: 'title_synonyms', title_synonyms: 'title_synonyms',
  keywords: 'keywords', skills: 'keywords',
  geo: 'geo', geography: 'geo', locations: 'geo',
  exclusions: 'exclusions', exclude: 'exclusions', excluded: 'exclusions',
  notes: 'notes', note: 'notes',
}

/**
 * Секция. Принимает { sectionType, title, items } (items — объекты или строки);
 * сам sectionType здесь не валидируется по enum — это делает normalizeSectionType
 * (в т.ч. русские названия), чтобы одна незнакомая секция не ронила весь ответ.
 */
const sectionSchema = z.preprocess((v) => {
  if (!isDict(v)) return v
  const sectionType = v.sectionType ?? v.section_type ?? v.type ?? v.section ?? v.key ?? v.id
  const items = v.items ?? v.values ?? v.entries ?? v.list ?? v.points
  return {
    sectionType: sectionType == null ? '' : String(sectionType),
    title: v.title == null ? null : String(v.title),
    items: Array.isArray(items) ? items.slice(0, 25) : [],
  }
}, z.object({
  sectionType: z.string(),
  title: z.string().nullish(),
  items: z.array(itemSchema),
}))

/**
 * Массив секций. Если модель вернула объект { title_synonyms: [...], keywords: [...] }
 * — разворачиваем в массив секций по ключам.
 */
function sectionsFromAny(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw
  if (!isDict(raw)) return []
  return Object.entries(raw)
    .filter(([, items]) => Array.isArray(items))
    .map(([key, items]) => ({ sectionType: SECTION_ALIASES[key.toLowerCase()] ?? key, items }))
}

// ─── Корневые схемы ─────────────────────────────────────────────────

export const sectionsOutputSchema = z.preprocess((input) => {
  const raw = unwrapEnvelope(input)
  if (Array.isArray(raw)) return { summary: null, sections: raw.slice(0, 8) }
  if (!isDict(raw)) return raw
  const direct = pickArray(raw, ['sections', 'секции', 'blocks', 'facts'])
  const nested = isDict(raw.sections) ? sectionsFromAny(raw.sections) : null
  let sections = direct ?? nested
  if (!sections) {
    // Секции лежат прямо в корне: { summary, title_synonyms: [...], keywords: [...] }
    const { summary: _s, verdict: _v, ...rest } = raw
    sections = sectionsFromAny(rest)
  }
  return {
    summary: pickString(raw, ['summary', 'verdict', 'вердикт']) ?? null,
    sections: sections.slice(0, 8),
  }
}, z.object({
  summary: z.string().nullish(),
  sections: z.array(sectionSchema),
}))

export const summaryOutputSchema = z.preprocess((input) => {
  const raw = unwrapEnvelope(input)
  if (typeof raw === 'string') return { summary: raw }
  if (!isDict(raw)) return raw
  return { summary: pickString(raw, ['summary', 'verdict', 'text', 'вердикт']) ?? '' }
}, z.object({ summary: z.string().min(1) }))

const donorSchema = z.preprocess((v) => {
  if (typeof v === 'string') return { name: v }
  if (!isDict(v)) return v
  const techStack = v.techStack ?? v.tech_stack ?? v.stack ?? v.technologies
  return {
    name: String(v.name ?? v.company ?? v.title ?? ''),
    layer: (v.layer ?? v.donorLayer ?? v.donor_layer ?? null) as unknown,
    priority: v.priority ?? null,
    rationale: (v.rationale ?? v.reason ?? v.why ?? v.comment ?? null) as unknown,
    industry: v.industry ?? v.domain ?? null,
    techStack: Array.isArray(techStack) ? techStack.map(String) : typeof techStack === 'string' ? techStack.split(/[,;]\s*/) : null,
  }
}, z.object({
  name: z.string(),
  layer: z.string().nullish(),
  priority: z.string().nullish(),
  rationale: z.string().nullish(),
  industry: z.string().nullish(),
  techStack: z.array(z.string()).nullish(),
}))

export const donorsOutputSchema = z.preprocess((input) => {
  const raw = unwrapEnvelope(input)
  if (Array.isArray(raw)) return { donors: raw.slice(0, 20) }
  if (!isDict(raw)) return raw
  const donors = pickArray(raw, ['donors', 'companies', 'donorCompanies', 'donor_companies', 'доноры', 'компании'])
  return { donors: (donors ?? []).slice(0, 20) }
}, z.object({ donors: z.array(donorSchema) }))

const toStringList = (v: unknown): string[] | null => {
  if (Array.isArray(v)) return v.map(x => String(x))
  if (typeof v === 'string') return v.split(/[,;]\s*/).map(s => s.trim()).filter(Boolean)
  return null
}

const segmentSchema = z.preprocess((v) => {
  if (!isDict(v)) return v
  return {
    name: String(v.name ?? v.title ?? v.hypothesis ?? ''),
    donorLayer: (v.donorLayer ?? v.donor_layer ?? v.layer ?? null) as unknown,
    titles: toStringList(v.titles ?? v.jobTitles ?? v.job_titles),
    keywords: toStringList(v.keywords ?? v.skills),
    geo: toStringList(v.geo ?? v.geography ?? v.locations ?? v.cities),
    channelCode: (v.channelCode ?? v.channel_code ?? v.channel ?? null) as unknown,
    priority: v.priority ?? null,
    rationale: (v.rationale ?? v.reason ?? v.why ?? null) as unknown,
  }
}, z.object({
  name: z.string(),
  donorLayer: z.string().nullish(),
  titles: z.array(z.string()).nullish(),
  keywords: z.array(z.string()).nullish(),
  geo: z.array(z.string()).nullish(),
  channelCode: z.string().nullish(),
  priority: z.string().nullish(),
  rationale: z.string().nullish(),
}))

export const segmentsOutputSchema = z.preprocess((input) => {
  const raw = unwrapEnvelope(input)
  if (Array.isArray(raw)) return { segments: raw.slice(0, 10) }
  if (!isDict(raw)) return raw
  const segments = pickArray(raw, ['segments', 'hypotheses', 'hypothesis', 'searchHypotheses', 'search_hypotheses', 'гипотезы'])
  return { segments: (segments ?? []).slice(0, 10) }
}, z.object({ segments: z.array(segmentSchema) }))

export const queryOutputSchema = z.preprocess((input) => {
  const raw = unwrapEnvelope(input)
  if (typeof raw === 'string') return { queryString: raw }
  if (!isDict(raw)) return raw
  return {
    queryString: pickString(raw, ['queryString', 'query_string', 'query', 'запрос']) ?? '',
    explanation: pickString(raw, ['explanation', 'comment', 'rationale', 'пояснение']) ?? null,
  }
}, z.object({ queryString: z.string().min(1), explanation: z.string().nullish() }))

export type SectionsOut = z.output<typeof sectionsOutputSchema>
export type SummaryOut = z.output<typeof summaryOutputSchema>
export type DonorsOut = z.output<typeof donorsOutputSchema>
export type SegmentsOut = z.output<typeof segmentsOutputSchema>
export type QueryOut = z.output<typeof queryOutputSchema>

/**
 * Если провайдер всё же передаёт схему модели (json_schema), ей нужна «чистая»
 * форма без preprocess — это и есть то, что модель должна вернуть в идеале.
 * Zod-схема выше при превращении в JSON Schema (zod-to-json-schema / toJSONSchema)
 * отдаёт именно внутренний объект, поэтому отдельного описания не требуется.
 */

/** Голый массив вместо объекта-обёртки: items => { sections: items } и т.п. (для extractJsonPayload). */
export const WRAP_BARE_ARRAY = {
  sections: (items: unknown[]) => ({ sections: items }),
  donors: (items: unknown[]) => ({ donors: items }),
  segments: (items: unknown[]) => ({ segments: items }),
} as const
