/**
 * Контекст генерации карты поиска: бриф, описание, существующие гипотезы.
 * docs/tz-search-map-v2.md §2a (R0).
 *
 * Чистые функции без БД — покрыты tests/unit/search-map-generation-context.test.ts.
 *
 * Зачем отдельный файл: до R0 buildGeneratePrompt читал поля брифа, которых нет в
 * схеме job_brief (roleProfile, seniority, salaryFrom…) — совпадало только niceToHave,
 * и «Дополнить по брифу» фактически работало без брифа. Здесь маппинг один и проверяемый.
 */

export type GenerationPart = 'sections' | 'donors' | 'segments' | 'summary' | 'query_string'

/** Поля job_brief (server/database/schema/app.ts). jsonb-поля могут быть массивом строк или объектов. */
export interface BriefLike {
  hardMustHave?: unknown
  niceToHave?: unknown
  dealBreakers?: unknown
  redFlagsToWatch?: unknown
  responsibilities?: string | null
  teamContext?: string | null
  interviewProcess?: string | null
  compensationNotes?: string | null
  idealProfile?: string | null
  sourcingHints?: string | null
  freeform?: string | null
}

export const BRIEF_EMPTY_FALLBACK = 'Бриф не заполнен — опирайся на описание вакансии и критерии оценки.'

const TEXT_LIMITS = {
  responsibilities: 1500,
  teamContext: 800,
  freeform: 1000,
  idealProfile: 1200,
  sourcingHints: 1200,
  compensationNotes: 400,
} as const

/** jsonb-массив брифа → список строк. Объекты: text ?? value ?? label ?? title. */
export function briefList(raw: unknown): string[] {
  if (!raw) return []
  const arr = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/\n|;/) : []
  const out: string[] = []
  const seen = new Set<string>()
  for (const el of arr) {
    let v = ''
    if (typeof el === 'string') v = el
    else if (el && typeof el === 'object') {
      const o = el as Record<string, unknown>
      v = String(o.text ?? o.value ?? o.label ?? o.title ?? o.name ?? '')
    }
    v = v.trim().replace(/\s+/g, ' ')
    if (!v) continue
    const key = v.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(v)
  }
  return out
}

function clip(text: string | null | undefined, limit: number): string | null {
  const t = (text ?? '').trim().replace(/\r\n?/g, '\n')
  if (!t) return null
  return t.length > limit ? `${t.slice(0, limit).trimEnd()}…` : t
}

function bullets(list: string[]): string {
  return list.map(v => `  - ${v}`).join('\n')
}

/**
 * Какие поля брифа нужны какой части генерации (ТЗ §2a.2).
 * `summary` получает всё, кроме процесса интервью — вердикт должен видеть полную картину.
 */
const FIELD_PARTS: Record<keyof Omit<BriefLike, 'interviewProcess'>, GenerationPart[]> = {
  hardMustHave: ['sections', 'donors', 'segments', 'summary', 'query_string'],
  niceToHave: ['sections', 'segments', 'summary', 'query_string'],
  dealBreakers: ['sections', 'segments', 'summary', 'query_string'],
  redFlagsToWatch: ['sections', 'summary'],
  idealProfile: ['donors', 'segments', 'summary', 'query_string'],
  sourcingHints: ['donors', 'segments', 'summary', 'query_string'],
  responsibilities: ['sections', 'summary'],
  teamContext: ['donors', 'summary'],
  compensationNotes: ['summary'],
  freeform: ['sections', 'donors', 'segments', 'summary'],
}

export interface BriefContext {
  /** Основной блок брифа для промпта (без sourcingHints). */
  text: string
  /** Подсказки по поиску — отдельным блоком в конце промпта части «гипотезы»/«доноры». */
  sourcingHints: string | null
  /** Сколько полей брифа реально заполнено. */
  filledFields: number
}

export function buildBriefContext(brief: BriefLike | null | undefined, part: GenerationPart): BriefContext {
  if (!brief) return { text: BRIEF_EMPTY_FALLBACK, sourcingHints: null, filledFields: 0 }

  const want = (field: keyof typeof FIELD_PARTS) => FIELD_PARTS[field].includes(part)
  const lines: string[] = []
  let filled = 0

  const must = briefList(brief.hardMustHave)
  if (must.length) { filled++; if (want('hardMustHave')) lines.push(`Must have (обязательно):\n${bullets(must)}`) }

  const nice = briefList(brief.niceToHave)
  if (nice.length) { filled++; if (want('niceToHave')) lines.push(`Nice to have:\n${bullets(nice)}`) }

  const breakers = briefList(brief.dealBreakers)
  if (breakers.length) { filled++; if (want('dealBreakers')) lines.push(`Не рассматриваем (deal-breakers):\n${bullets(breakers)}`) }

  const flags = briefList(brief.redFlagsToWatch)
  if (flags.length) { filled++; if (want('redFlagsToWatch')) lines.push(`Красные флаги в резюме:\n${bullets(flags)}`) }

  const ideal = clip(brief.idealProfile, TEXT_LIMITS.idealProfile)
  if (ideal) { filled++; if (want('idealProfile')) lines.push(`Идеальный профиль (по словам нанимающего менеджера):\n${ideal}`) }

  const resp = clip(brief.responsibilities, TEXT_LIMITS.responsibilities)
  if (resp) { filled++; if (want('responsibilities')) lines.push(`Обязанности:\n${resp}`) }

  const team = clip(brief.teamContext, TEXT_LIMITS.teamContext)
  if (team) { filled++; if (want('teamContext')) lines.push(`Команда и контекст:\n${team}`) }

  const comp = clip(brief.compensationNotes, TEXT_LIMITS.compensationNotes)
  if (comp) { filled++; if (want('compensationNotes')) lines.push(`Компенсация:\n${comp}`) }

  const free = clip(brief.freeform, TEXT_LIMITS.freeform)
  if (free) { filled++; if (want('freeform')) lines.push(`Прочее из брифа:\n${free}`) }

  const hints = clip(brief.sourcingHints, TEXT_LIMITS.sourcingHints)
  if (hints) filled++

  return {
    text: lines.length ? `Бриф вакансии:\n${lines.join('\n\n')}` : BRIEF_EMPTY_FALLBACK,
    sourcingHints: hints && want('sourcingHints') ? hints : null,
    filledFields: filled,
  }
}

// ─── Описание вакансии ──────────────────────────────────────────────────────

export const DESCRIPTION_LIMIT = 6000
const DESCRIPTION_HEAD = 4000
const DESCRIPTION_TAIL = 2000

/** Снимаем HTML (описания с hh приходят с разметкой), декодируем базовые сущности, схлопываем пробелы. */
export function stripHtml(html: string): string {
  return html
    .replace(/<\s*(br|\/p|\/li|\/div|\/h\d|\/tr)\s*\/?>/gi, '\n')
    .replace(/<\s*li\b[^>]*>/gi, '• ')
    // инлайновые теги (b, strong, em, a, span…) убираем без пробела, блочные — через пробел
    .replace(/<\/?(b|strong|i|em|u|s|a|span|code|small|sup|sub|mark)\b[^>]*>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/ +([.,;:!?])/g, '$1')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, '\'')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Описание в промпт: до 6000 символов. Длиннее — первые 4000 + последние 2000
 * (требования и условия обычно в конце), с явной пометкой о пропуске.
 */
export function prepareDescription(description: string | null | undefined): string | null {
  if (!description) return null
  const text = stripHtml(description)
  if (!text) return null
  if (text.length <= DESCRIPTION_LIMIT) return text
  const skipped = text.length - DESCRIPTION_HEAD - DESCRIPTION_TAIL
  return `${text.slice(0, DESCRIPTION_HEAD).trimEnd()}\n[… пропущено ${skipped} символов …]\n${text.slice(-DESCRIPTION_TAIL).trimStart()}`
}

// ─── Существующие гипотезы ──────────────────────────────────────────────────

export interface ExistingSegmentLike {
  name: string
  donorLayer?: string | null
  channelCode?: string | null
  titles?: string[] | null
}

/**
 * Семантический ключ гипотезы: слой + канал + отсортированные тайтлы.
 * Две гипотезы с разными названиями, но одинаковым набором — дубль (ТЗ §2a.4).
 */
export function segmentSemanticKey(seg: ExistingSegmentLike): string {
  const norm = (s: string) => s.toLowerCase().trim().replace(/ё/g, 'е').replace(/\s+/g, ' ')
  const titles = [...new Set((seg.titles ?? []).map(norm).filter(Boolean))].sort()
  return `${norm(seg.donorLayer ?? '')}|${norm(seg.channelCode ?? '')}|${titles.join(',')}`
}

export function formatExistingSegments(list: ExistingSegmentLike[]): string | null {
  if (!list.length) return null
  const rows = list.slice(0, 30).map(s => {
    const titles = (s.titles ?? []).slice(0, 3).join(', ')
    return `  — ${s.name} · ${s.donorLayer ?? '—'} · ${s.channelCode ?? '—'}${titles ? ` · ${titles}` : ''}`
  })
  return `Уже есть гипотезы (не повторяй их по смыслу — предлагай другие слои, каналы или тайтлы):\n${rows.join('\n')}`
}
