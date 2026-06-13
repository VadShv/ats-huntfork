/**
 * hh.ru /resumes query schema, URL parser, and helpers.
 *
 * A `SourcingQuery` is the structured representation of an hh.ru search.
 * It can be authored three ways:
 *   1. Hand-built via the UI constructor.
 *   2. Parsed from a pasted hh.ru search URL (e.g. https://hh.ru/search/resume?...).
 *   3. AI-generated from a job description (server/utils/hh/sourcing/aiQuery.ts).
 *
 * We persist the validated `SourcingQuery` as JSON in `hh_saved_search.query`,
 * then expand it into a flat `HhQueryParams` for the hh.ru REST call.
 *
 * Spec reference:
 *   - https://api.hh.ru/openapi/redoc (resume search section)
 *   - https://github.com/hhru/api/blob/master/docs/resumes_search.md
 *   - https://hh.ru/article/1175 (search language: AND/OR/NOT, quotes, parentheses)
 */
import { z } from 'zod'
import type { HhQueryParams } from '../client'

/** Period filter values understood by hh.ru (days). */
export const HH_PERIODS = [1, 3, 7, 14, 30, 60, 365] as const

/**
 * Нормализует текст поисковой строки для hh.ru:
 *   «» / “” / ‘’ → прямые кавычки "
 *   — / – → пробел (hh иногда воспринимает это как минус в booleam-синтаксе)
 *   Множественные пробелы → один.
 *
 * hh интерпретирует «» буквально и не выполняет поиск фраз.
 */
export function normalizeHhQueryText(text: string | undefined | null): string | undefined {
  if (!text) return undefined
  const out = text
    .replace(/[«»“”‘’„‚]/g, '"')
    .replace(/[—–]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return out.length > 0 ? out : undefined
}

/** Schedule values per hh.ru dictionaries (/dictionaries → "schedule"). DEPRECATED, см. workFormat. */
export const HH_SCHEDULES = [
  'fullDay',
  'shift',
  'flexible',
  'remote',
  'flyInFlyOut',
] as const

/** Employment values per hh.ru dictionaries (/dictionaries → "employment"). DEPRECATED, см. employmentForm. */
export const HH_EMPLOYMENT = [
  'full',
  'part',
  'project',
  'volunteer',
  'probation',
] as const

/** Experience levels per hh.ru dictionaries. */
export const HH_EXPERIENCE = [
  'noExperience',
  'between1And3',
  'between3And6',
  'moreThan6',
] as const

/** Educational level values per hh.ru dictionaries. */
export const HH_EDUCATION = [
  'secondary',
  'special_secondary',
  'unfinished_higher',
  'higher',
  'bachelor',
  'master',
  'candidate',
  'doctor',
] as const

/** Order_by values per hh.ru spec. */
export const HH_ORDER_BY = [
  'relevance',
  'publication_time',
  'salary_asc',
  'salary_desc',
] as const

/**
 * Логика интерпретации text.
 * https://api.hh.ru/openapi/redoc#tag/Poisk-rezyume/operation/get-resumes
 */
export const HH_TEXT_LOGIC = ['all', 'any', 'phrase', 'except'] as const

/**
 * В какой части резюме искать text. По умолчанию hh ищет 'everywhere'.
 */
export const HH_TEXT_FIELD = [
  'everywhere',
  'title',
  'education',
  'skills',
  'experience',
  'experience_company',
  'experience_position',
  'experience_description',
] as const

/** Период публикации/обновления резюме как enum (для поля text.period). */
export const HH_TEXT_PERIOD = ['all_time', 'last_year', 'last_three_years', 'last_six_years'] as const

/**
 * Современные значения формата работы (заменяют устаревший `schedule`).
 * /dictionaries → "work_format".
 */
export const HH_WORK_FORMAT = [
  'ON_SITE',
  'REMOTE',
  'HYBRID',
  'FIELD_WORK',
] as const

/**
 * Современные значения формы занятости (заменяют устаревший `employment`).
 * /dictionaries → "employment_form".
 */
export const HH_EMPLOYMENT_FORM = [
  'FULL',
  'PART',
  'PROJECT',
  'FLY_IN_FLY_OUT',
] as const

export const sourcingQuerySchema = z
  .object({
    /** Free-text query. Поддерживает язык поиска hh.ru: AND/OR/NOT, "фразы", (группы), * как суффикс. */
    text: z.string().max(2000).optional(),
    /**
     * Логика обработки text.
     *   all     — все слова (по умолчанию)
     *   any     — любое из слов
     *   phrase  — точная фраза
     *   except  — исключить эти слова
     */
    textLogic: z.enum(HH_TEXT_LOGIC).optional(),
    /** В какой части резюме искать text. По умолчанию everywhere. */
    textField: z.enum(HH_TEXT_FIELD).optional(),
    /** Период публикации/обновления резюме (enum, отдельно от числового period). */
    textPeriod: z.enum(HH_TEXT_PERIOD).optional(),
    /** Region IDs (hh /areas). */
    area: z.array(z.string()).max(50).optional(),
    /** Metro station IDs. */
    metro: z.array(z.string()).max(20).optional(),
    /** Experience level codes. */
    experience: z.array(z.enum(HH_EXPERIENCE)).optional(),
    /** DEPRECATED: legacy employment types. Используй employmentForm. Оставлено для совместимости со старыми сохранёнными запросами и parseHhSearchUrl. */
    employment: z.array(z.enum(HH_EMPLOYMENT)).optional(),
    /** DEPRECATED: legacy work schedule. Используй workFormat. */
    schedule: z.array(z.enum(HH_SCHEDULES)).optional(),
    /** Современный формат работы (REMOTE/HYBRID/...). */
    workFormat: z.array(z.enum(HH_WORK_FORMAT)).optional(),
    /** Современная форма занятости (FULL/PART/...). */
    employmentForm: z.array(z.enum(HH_EMPLOYMENT_FORM)).optional(),
    /** Education level. */
    educationLevel: z.array(z.enum(HH_EDUCATION)).optional(),
    /**
     * Профессиональные роли. ID из /professional_roles. Не строки!
     * Числа кодируем как строки, потому что hh API принимает их как ?professional_role=156.
     */
    professionalRole: z.array(z.string()).max(20).optional(),
    /** Min salary. Pair with `currency`. */
    salaryFrom: z.number().int().min(0).max(100_000_000).optional(),
    /** Max salary. */
    salaryTo: z.number().int().min(0).max(100_000_000).optional(),
    /** Salary currency (ISO code, defaults to RUR). */
    currency: z.string().length(3).optional(),
    /** Days the resume was last updated within (числовой период, см. также textPeriod). */
    period: z.number().refine(
      (v) => HH_PERIODS.includes(v as typeof HH_PERIODS[number]),
      { message: 'period must be one of 1,3,7,14,30,60,365' },
    ).optional(),
    /** Languages required (e.g. ["eng.b2", "deu.a1"]). */
    language: z.array(z.string()).max(10).optional(),
    /**
     * Skill IDs из hh.ru словаря (НЕ строки!). Этот фильтр работает только с числовыми
     * идентификаторами из /suggests/skills. AI и UI обычно его не заполняют — оставлено
     * только для совместимости с parseHhSearchUrl, когда юзер вставил URL с ?skill=123.
     * Передавать сюда произвольные строки вроде "Python" — нельзя, hh ответит 400.
     */
    skill: z.array(z.string().max(20)).max(30).optional(),
    /** Has photo. */
    label: z.array(z.string()).optional(),
    /** Relocation readiness ("relocation_possible" / "living_or_relocation"). */
    relocation: z.string().max(50).optional(),
    /** Gender ('male' | 'female'). */
    gender: z.enum(['male', 'female']).optional(),
    /** Min age. */
    ageFrom: z.number().int().min(14).max(99).optional(),
    /** Max age. */
    ageTo: z.number().int().min(14).max(99).optional(),
    /** Result ordering. */
    orderBy: z.enum(HH_ORDER_BY).optional(),
    /** Items per page (10/20/50/100). */
    perPage: z.number().int().min(10).max(100).optional(),
  })
  .strict()

export type SourcingQuery = z.infer<typeof sourcingQuerySchema>

/**
 * Expand a structured query into hh /resumes REST parameters.
 *
 * Boolean/array splitting follows the hh.ru convention: multi-value fields
 * are repeated keys, `salary` is a single integer paired with `currency`.
 */
export function expandQueryForHhApi(
  query: SourcingQuery,
  page: number,
  perPage = 50,
): HhQueryParams {
  const out: HhQueryParams = {
    page,
    per_page: query.perPage ?? perPage,
  }

  if (query.text) out.text = query.text
  if (query.textLogic) out['text.logic'] = query.textLogic
  if (query.textField) out['text.field'] = query.textField
  if (query.textPeriod) out['text.period'] = query.textPeriod
  if (query.area?.length) out.area = query.area
  if (query.metro?.length) out.metro = query.metro
  if (query.experience?.length) out.experience = query.experience
  if (query.employment?.length) out.employment = query.employment
  if (query.schedule?.length) out.schedule = query.schedule
  if (query.workFormat?.length) out.work_format = query.workFormat
  if (query.employmentForm?.length) out.employment_form = query.employmentForm
  if (query.educationLevel?.length) out.education_level = query.educationLevel
  if (query.professionalRole?.length) out.professional_role = query.professionalRole
  if (query.salaryFrom !== undefined) out.salary_from = query.salaryFrom
  if (query.salaryTo !== undefined) out.salary_to = query.salaryTo
  if (query.currency) out.currency = query.currency
  if (query.period !== undefined) out.period = query.period
  if (query.language?.length) out.language = query.language
  if (query.skill?.length) out.skill = query.skill
  if (query.label?.length) out.label = query.label
  if (query.relocation) out.relocation = query.relocation
  if (query.gender) out.gender = query.gender
  if (query.ageFrom !== undefined) out.age_from = query.ageFrom
  if (query.ageTo !== undefined) out.age_to = query.ageTo
  if (query.orderBy) out.order_by = query.orderBy

  return out
}

/**
 * Parse an hh.ru search URL into a SourcingQuery. Tolerant: unknown params
 * are dropped, malformed numbers are coerced or skipped, and arrays are
 * collected from repeated `?area=1&area=2` keys.
 *
 * Throws if the URL is not a parseable URL at all.
 */
export function parseHhSearchUrl(url: string): SourcingQuery {
  const u = new URL(url)
  const params = u.searchParams
  const raw: Record<string, unknown> = {}

  // Helpers --------------------------------------------------------------
  const getAll = (key: string) => params.getAll(key).filter(Boolean)
  const num = (s: string | null): number | undefined => {
    if (s === null || s === '') return undefined
    const n = Number(s)
    return Number.isFinite(n) ? n : undefined
  }

  // Free-text ------------------------------------------------------------
  const text = params.get('text')
  if (text) raw.text = text
  const textLogic = params.get('text.logic')
  if (textLogic) raw.textLogic = textLogic
  const textField = params.get('text.field')
  if (textField) raw.textField = textField
  const textPeriod = params.get('text.period')
  if (textPeriod) raw.textPeriod = textPeriod

  // Multi-value strings --------------------------------------------------
  const multi: Array<[string, string]> = [
    ['area', 'area'],
    ['metro', 'metro'],
    ['experience', 'experience'],
    ['employment', 'employment'],
    ['schedule', 'schedule'],
    ['work_format', 'workFormat'],
    ['employment_form', 'employmentForm'],
    ['education_level', 'educationLevel'],
    ['professional_role', 'professionalRole'],
    ['language', 'language'],
    ['skill', 'skill'],
    ['label', 'label'],
  ]
  for (const [hh, ours] of multi) {
    const vals = getAll(hh)
    if (vals.length) raw[ours] = vals
  }

  // Salary ---------------------------------------------------------------
  const salaryFrom = num(params.get('salary_from'))
  if (salaryFrom !== undefined) raw.salaryFrom = salaryFrom
  const salaryTo = num(params.get('salary_to'))
  if (salaryTo !== undefined) raw.salaryTo = salaryTo
  const currency = params.get('currency')
  if (currency) raw.currency = currency

  // Period ---------------------------------------------------------------
  const period = num(params.get('period'))
  if (period !== undefined) raw.period = period

  // Relocation / gender / age -------------------------------------------
  const relocation = params.get('relocation')
  if (relocation) raw.relocation = relocation
  const gender = params.get('gender')
  if (gender === 'male' || gender === 'female') raw.gender = gender
  const ageFrom = num(params.get('age_from'))
  if (ageFrom !== undefined) raw.ageFrom = ageFrom
  const ageTo = num(params.get('age_to'))
  if (ageTo !== undefined) raw.ageTo = ageTo

  // Ordering / pagination -----------------------------------------------
  const orderBy = params.get('order_by')
  if (orderBy) raw.orderBy = orderBy

  // Parse-strict against schema (drops unknowns, validates enums).
  return sourcingQuerySchema.parse(raw)
}
