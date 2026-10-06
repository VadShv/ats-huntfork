/**
 * Нормализация словаря ответа ИИ → enum'ы БД карты поиска.
 *
 * Модели (особенно reasoning-семейства Cloud.ru) регулярно игнорируют enum в JSON-схеме
 * и пишут "P1", "высокий", "hh.ru", "key_skills". Если держать строгий z.enum —
 * весь ответ отбрасывается после минуты генерации. Поэтому схема ответа принимает
 * строки, а сюда приходит «что выдала модель» и уходит «что примет Postgres»
 * (или null → пункт пропускается с warning).
 */

export type SectionType = 'title_synonyms' | 'keywords' | 'geo' | 'exclusions' | 'notes'
export type Priority = 'high' | 'medium' | 'low'
export type DonorLayer = 'core' | 'adjacent' | 'school' | 'alumni' | 'custom'

export const SECTION_TYPES: SectionType[] = ['title_synonyms', 'keywords', 'geo', 'exclusions', 'notes']

export const SECTION_TITLES: Record<SectionType, string> = {
  title_synonyms: 'Тайтлы и синонимы',
  keywords: 'Ключевые слова и навыки',
  geo: 'География',
  exclusions: 'Исключения',
  notes: 'Заметки',
}

const clean = (v: unknown) => String(v ?? '').toLowerCase().trim().replace(/[\s\-.]+/g, '_')

export function normalizeSectionType(raw: unknown): SectionType | null {
  const v = clean(raw)
  if (!v) return null
  if (/(title|synonym|тайтл|синоним|должност|позици|role_name)/.test(v)) return 'title_synonyms'
  if (/(keyword|skill|stack|must|nice|навык|ключев|технолог|компетенц|tech)/.test(v)) return 'keywords'
  if (/(geo|location|город|регион|географ|локац|format|remote|релок)/.test(v)) return 'geo'
  if (/(exclu|stop|исключ|стоп|negative|blacklist)/.test(v)) return 'exclusions'
  if (/(note|замет|level|domain|уровень|grade|other|custom|misc|comment)/.test(v)) return 'notes'
  return null
}

export function normalizePriority(raw: unknown, fallback: Priority = 'medium'): Priority {
  const v = clean(raw)
  if (!v) return fallback
  if (/^(high|p1|1|a|высок|критич|top|топ|max)/.test(v)) return 'high'
  if (/^(low|p3|3|c|низк|min|minor)/.test(v)) return 'low'
  if (/^(medium|mid|p2|2|b|средн|normal)/.test(v)) return 'medium'
  return fallback
}

export function normalizeLayer(raw: unknown): DonorLayer | null {
  const v = clean(raw)
  if (!v) return null
  if (/(core|ядро|прям|direct|tier_?1|основн)/.test(v)) return 'core'
  if (/(adjacent|смежн|related|near|tier_?2|сосед)/.test(v)) return 'adjacent'
  if (/(school|школ|academy|консалт|consult|big_?4|аудит)/.test(v)) return 'school'
  if (/(alumni|выпуск|ex_|бывш)/.test(v)) return 'alumni'
  if (/(custom|сво|other|друг)/.test(v)) return 'custom'
  return 'custom'
}

/**
 * Подбор канала организации по коду/названию из ответа модели.
 * Сначала точный код, затем алиасы, затем вхождение названия.
 */
export function resolveChannel<T extends { id: string; code: string; name: string }>(raw: unknown, channels: T[]): T | null {
  const v = clean(raw)
  if (!v) return null
  const exact = channels.find(c => clean(c.code) === v)
  if (exact) return exact

  const aliases: Array<[RegExp, string]> = [
    [/^(hh|hh_ru|headhunter|хх|хедхантер)/, 'hh'],
    [/(xray|x_ray).*(linkedin|li)/, 'google_xray_linkedin'],
    [/(xray|x_ray).*(github|gh)/, 'google_xray_github'],
    [/linkedin|линкед/, 'linkedin'],
    [/github|гитхаб/, 'github'],
    [/telegram|телеграм|tg/, 'telegram'],
    [/habr|хабр|career/, 'habr'],
    [/referr|реферал|рекоменд/, 'referral'],
  ]
  for (const [re, code] of aliases) {
    if (re.test(v)) {
      const found = channels.find(c => c.code === code)
      if (found) return found
    }
  }
  return channels.find(c => clean(c.name) === v || v.includes(clean(c.name)) || clean(c.name).includes(v)) ?? null
}

export const normalizeItemValue = (v: string) => v.toLowerCase().trim().replace(/ё/g, 'е')

export function cleanList(list: unknown, max: number): string[] {
  if (!Array.isArray(list)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of list) {
    const v = String(raw ?? '').trim()
    if (!v) continue
    const key = v.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(v.slice(0, 200))
    if (out.length >= max) break
  }
  return out
}
