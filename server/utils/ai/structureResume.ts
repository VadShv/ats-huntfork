/**
 * Структурирование резюме из плоского текста (PDF/DOC/DOCX) в hh-совместимый JSON.
 *
 * Единообразие карточки кандидата: результат кладётся в candidate.hh_resume_raw
 * в той же форме, какую отдаёт hh API. Благодаря этому весь существующий стек —
 * parseHhResume → HhResumeView, версии резюме, AI-саммари, полнотекстовый поиск,
 * дедуп и скоринг — работает для загруженных файлов без изменений.
 *
 * Источник помечается служебным маркером `_hf.source = 'document_parse'`.
 * Настоящий hh-снепшот (hh_resume_id != null) приоритетен и НЕ перезаписывается —
 * проверка на стороне эндпоинта.
 *
 * Все поля схемы обязательные (пустая строка / 0 / пустой массив = «нет данных») —
 * так надёжнее работает structured output у строгих провайдеров.
 */
import { z } from 'zod'
import { loadAiConfig } from './loadConfig'
import { generateStructuredOutput } from './provider'

const experienceItemSchema = z.object({
  company: z.string().describe('Название компании; "" если неизвестно'),
  position: z.string().describe('Должность; "" если неизвестно'),
  start: z.string().describe('Начало работы в формате YYYY-MM-01; "" если неизвестно'),
  end: z.string().describe('Окончание работы YYYY-MM-01; "" если работает по настоящее время'),
  description: z.string().describe('Обязанности и достижения, кратко; "" если нет'),
})

const educationItemSchema = z.object({
  organization: z.string().describe('Учебное заведение'),
  name: z.string().describe('Факультет / специальность; "" если нет'),
  result: z.string().describe('Степень или квалификация; "" если нет'),
  year: z.number().int().describe('Год окончания; 0 если неизвестен'),
})

export const structuredResumeSchema = z.object({
  firstName: z.string().describe('Имя кандидата; "" если не найдено'),
  lastName: z.string().describe('Фамилия кандидата; "" если не найдено'),
  middleName: z.string().describe('Отчество; "" если нет'),
  title: z.string().describe('Желаемая должность или текущая специализация; "" если нет'),
  birthDate: z.string().describe('Дата рождения YYYY-MM-DD; "" если нет'),
  gender: z.enum(['male', 'female', 'unknown']).describe('Пол, только если однозначно ясен из текста'),
  area: z.string().describe('Город проживания; "" если нет'),
  salaryAmount: z.number().int().describe('Зарплатные ожидания числом; 0 если не указаны'),
  salaryCurrency: z.string().describe('Валюта зарплаты: RUR, USD, EUR; "" если не указана'),
  totalExperienceMonths: z.number().int().describe('Общий стаж в месяцах; 0 если не удаётся оценить'),
  experience: z.array(experienceItemSchema).describe('Опыт работы, от последнего места к раннему'),
  education: z.array(educationItemSchema).describe('Образование'),
  skills: z.array(z.string()).describe('Ключевые навыки — короткие тэги (1-4 слова)'),
  about: z.string().describe('Раздел «О себе» / профессиональное саммари; "" если нет'),
  languages: z.array(z.object({
    name: z.string().describe('Язык, напр. «Английский»'),
    level: z.string().describe('Уровень, напр. «B2 — Средне-продвинутый»; "" если нет'),
  })).describe('Владение языками'),
  contacts: z.array(z.object({
    type: z.enum(['phone', 'email', 'telegram', 'linkedin', 'github', 'other']),
    value: z.string(),
  })).describe('Контакты, найденные в резюме'),
})

export type StructuredResume = z.infer<typeof structuredResumeSchema>

/** ""/0 → undefined, чтобы не засорять raw пустыми полями. */
function s(v: string | undefined): string | undefined {
  const t = (v ?? '').trim()
  return t || undefined
}
function n(v: number | undefined): number | undefined {
  return typeof v === 'number' && v > 0 ? v : undefined
}

/** Индекс месяца от нулевого года для 'YYYY-MM…'; null если не парсится. */
function monthIndex(dateStr: string | undefined): number | null {
  const m = (dateStr ?? '').match(/^(\d{4})-(\d{2})/)
  if (!m) return null
  const year = parseInt(m[1]!, 10)
  const month = parseInt(m[2]!, 10)
  if (year < 1950 || year > 2100 || month < 1 || month > 12) return null
  return year * 12 + (month - 1)
}

/**
 * Суммарный стаж по интервалам опыта со слиянием пересечений
 * (параллельные работы не считаются дважды).
 */
export function computeExperienceMonths(
  experience: Array<{ start: string, end: string }>,
  now = new Date(),
): number {
  const nowIdx = now.getFullYear() * 12 + now.getMonth()
  const intervals: Array<[number, number]> = []
  for (const e of experience) {
    const start = monthIndex(e.start)
    if (start === null) continue
    const end = monthIndex(e.end) ?? nowIdx
    if (end > start) intervals.push([start, Math.min(end, nowIdx)])
  }
  intervals.sort((a, b) => a[0] - b[0])
  let total = 0
  let curStart: number | null = null
  let curEnd = 0
  for (const [st, en] of intervals) {
    if (curStart === null || st > curEnd) {
      if (curStart !== null) total += curEnd - curStart
      curStart = st
      curEnd = en
    }
    else if (en > curEnd) {
      curEnd = en
    }
  }
  if (curStart !== null) total += curEnd - curStart
  return total
}

export interface StructureMeta {
  documentId?: string | null
  sourceFilename?: string | null
  provider?: string | null
  model?: string | null
  /**
   * Маркер источника структуры в `_hf.source`.
   * 'document_parse' — разбор загруженного файла (по умолчанию, историческое поведение);
   * 'extension_capture' — захват со страницы через расширение Sidekick.
   */
  source?: 'document_parse' | 'extension_capture'
  /** URL страницы-источника (для extension_capture). */
  sourceUrl?: string | null
  /** Идентификатор площадки: linkedin | habr | github | hunt | podbor | generic. */
  site?: string | null
}

/**
 * Сборка hh-совместимого raw JSON из ответа LLM.
 * Поля названы и вложены ровно так, как их читает parseHhResume()
 * (см. server/utils/hh/resume-render.ts) и dedup/extract.
 */
export function buildHhCompatibleRaw(p: StructuredResume, meta: StructureMeta): Record<string, unknown> {
  const experience = p.experience
    .filter(e => s(e.company) || s(e.position) || s(e.description))
    .map(e => ({
      company: s(e.company),
      position: s(e.position),
      start: s(e.start),
      end: s(e.end),
      description: s(e.description),
    }))

  const educationPrimary = p.education
    .filter(e => s(e.organization) || s(e.name))
    .map(e => ({
      organization: s(e.organization),
      name: s(e.name),
      result: s(e.result),
      year: n(e.year),
    }))

  const totalMonths = n(p.totalExperienceMonths) ?? computeExperienceMonths(p.experience)

  // hh использует id 'cell' для мобильного телефона и 'email' для почты.
  const contactTypeToHhId: Record<string, string> = {
    phone: 'cell',
    email: 'email',
    telegram: 'telegram',
    linkedin: 'linkedin',
    github: 'github',
    other: 'other',
  }
  const contact = p.contacts
    .filter(c => s(c.value))
    .map(c => ({ type: { id: contactTypeToHhId[c.type] ?? 'other' }, value: c.value.trim() }))

  const language = p.languages
    .filter(l => s(l.name))
    .map(l => ({ name: l.name.trim(), ...(s(l.level) ? { level: { name: l.level.trim() } } : {}) }))

  const raw: Record<string, unknown> = {
    first_name: s(p.firstName),
    last_name: s(p.lastName),
    middle_name: s(p.middleName),
    title: s(p.title),
    birth_date: s(p.birthDate),
    ...(p.gender !== 'unknown'
      ? { gender: { id: p.gender, name: p.gender === 'male' ? 'Мужской' : 'Женский' } }
      : {}),
    ...(s(p.area) ? { area: { name: p.area.trim() } } : {}),
    ...(n(p.salaryAmount)
      ? { salary: { amount: p.salaryAmount, currency: s(p.salaryCurrency) ?? 'RUR' } }
      : {}),
    ...(totalMonths > 0 ? { total_experience: { months: totalMonths } } : {}),
    experience,
    education: { primary: educationPrimary },
    skill_set: p.skills.map(sk => sk.trim()).filter(Boolean),
    skills: s(p.about), // hh кладёт длинный текст «о себе» в поле `skills`
    language,
    contact,
    // Служебный маркер Huntfork: источник структуры — не hh, а разбор файла/захват.
    _hf: {
      source: meta.source ?? 'document_parse',
      documentId: meta.documentId ?? undefined,
      sourceFilename: meta.sourceFilename ?? undefined,
      sourceUrl: meta.sourceUrl ?? undefined,
      site: meta.site ?? undefined,
      structuredAt: new Date().toISOString(),
      provider: meta.provider ?? undefined,
      model: meta.model ?? undefined,
    },
  }
  return raw
}

/**
 * Разбор текста резюме через настроенный в организации 'analysis'-провайдер
 * (тот же, что для AI-саммари; скрининговый контур не затрагивается).
 */
export async function structureResumeFromText(opts: { orgId: string, text: string }) {
  const config = await loadAiConfig(opts.orgId, { purpose: 'analysis', preferId: null })

  // Нормализуем пробелы и ограничиваем объём — резюме длиннее 15k символов
  // почти всегда содержат мусор из PDF-экстракции.
  const text = opts.text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').slice(0, 15_000)

  const { object, usage } = await generateStructuredOutput(config, {
    system:
      'Ты ассистент рекрутера. Разложи сырой текст резюме на структурированные поля. '
      + 'Используй ТОЛЬКО факты из текста — ничего не выдумывай. '
      + 'Если данных нет, верни пустую строку, 0 или пустой массив. '
      + 'Даты приводи к формату YYYY-MM-01 (день всегда 01). '
      + 'Текст может быть распознан из PDF с артефактами переносов — игнорируй мусор и восстанавливай смысл.',
    prompt: `Разложи следующее резюме на структурированные поля.\n\n<резюме>\n${text}\n</резюме>`,
    schema: structuredResumeSchema,
    schemaName: 'structured_resume',
    schemaDescription: 'Структурированное представление резюме кандидата',
  })

  return { parsed: object, usage, config }
}
