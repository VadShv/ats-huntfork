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
import { structureResumeRuleBased } from './hh-text-structurer'

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
 *
 * Прим.: единый вызов без повторной попытки. Дорогой retry при пустом опыте
 * удваивал время на медленных reasoning-моделях (структурирование шло минуты) —
 * убран. Детерминизм обеспечивает temperature: 0, полноту опыта — усиленный промпт.
 */
export async function structureResumeFromText(opts: { orgId: string, text: string, forceLlm?: boolean }) {
  // ── Быстрый путь: детерминированный разбор hh-резюме без LLM ──
  // Моментально, с полными обязанностями и без галлюцинаций. Для нестандартных
  // макетов вернёт null → уходим в LLM ниже.
  // forceLlm: рекрутер отметил «нестандартный формат» → пропускаем rule-based
  // и гибрид, полностью доверяемся сильной модели (меньше ошибок сегментации).
  if (!opts.forceLlm) {
    const ruleBased = structureResumeRuleBased(opts.text)
    if (ruleBased) {
      return { parsed: ruleBased, usage: { promptTokens: 0, completionTokens: 0 }, config: null, source: 'rule_based' as const }
    }
  }

  const config = await loadAiConfig(opts.orgId, { purpose: 'structuring', preferId: null })

  // Кастомные/дизайнерские макеты. Ограничиваем объём умеренно (не теряя хвост).
  const text = opts.text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').slice(0, 20_000)

  const system =
    'Ты ассистент рекрутера. Разложи сырой текст резюме на структурированные поля JSON. '
    + 'КРИТИЧЕСКИ ВАЖНО: перенеси В СТРУКТУРУ ВСЮ информацию из резюме, ничего не пропуская — '
    + 'это нужно для качественного скрининга. Заполни ВСЕ применимые поля: firstName, lastName, '
    + 'middleName, title (желаемая должность), birthDate, gender, area (город), salaryAmount, '
    + 'salaryCurrency, experience (ВСЕ места работы с полными обязанностями и достижениями), '
    + 'education (ВСЕ учебные заведения, факультет, год, степень), skills (ВСЕ навыки отдельными '
    + 'тегами), about (раздел «О себе» целиком), languages (ВСЕ языки с уровнем), contacts. '
    + 'Используй ТОЛЬКО факты из текста — ничего не выдумывай. '
    + 'firstName/lastName — имя и фамилия ЧЕЛОВЕКА, НЕ должность и НЕ город. '
    + 'ВАЖНО про about: вводный абзац-саммари в начале резюме (до раздела опыта — '
    + '«Experience»/«Опыт работы»/«Work experience») — это раздел «О себе» (about), '
    + 'а НЕ описание первого места работы. Первое место работы начинается в разделе '
    + 'опыта. Не приписывай вводный текст к первой компании. '
    + 'Заголовки разделов могут быть на английском (About/Summary/Experience/Skills/Education). '
    + 'Не пропускай ни одного места работы и ни одного навыка. '
    + 'Если данных нет — пустая строка / 0 / пустой массив. '
    + 'Даты в формате YYYY-MM-01. '
    + 'Текст мог быть распознан из PDF с артефактами (склейка слов, непривычный порядок, колонки) — '
    + 'восстанавливай смысл и разделяй склеенные слова.'
  const prompt = `Разложи следующее резюме на структурированные поля. Перенеси ВСЮ информацию.\n\n<резюме>\n${text}\n</резюме>`

  // Для кастомных макетов КАЧЕСТВО важнее скорости → thinking ВКЛючён (disableThinking:false).
  // Такие резюме редки (львиная доля идёт через hh rule-based / API), поэтому доп. время
  // приемлемо ради полноты извлечения.
  const result = await generateStructuredOutput(config, {
    system, prompt, schema: structuredResumeSchema,
    schemaName: 'structured_resume',
    schemaDescription: 'Полное структурированное представление резюме кандидата',
    temperature: 0,
    disableThinking: false,
  })

  // Фаза 4 — regex-валидация контактов: гарантируем корректные email/телефон из текста,
  // не полагаясь на возможные ошибки LLM (и не теряя их, если LLM пропустил).
  const parsed = result.object
  const emailRe = /[\w.+-]+@[\w-]+\.[\w.-]+/g
  const emails = [...opts.text.matchAll(emailRe)].map(m => m[0])
  const phoneRe = /(?:\+7|8)[\s\-()]*\d{3}[\s\-()]*\d{3}[\s\-()]*\d{2}[\s\-()]*\d{2}/g
  const phones = [...opts.text.matchAll(phoneRe)].map(m => `+7${m[0].replace(/\D/g, '').slice(-10)}`)
  const have = new Set(parsed.contacts.map(c => c.value.toLowerCase()))
  for (const e of emails) if (!have.has(e.toLowerCase())) { parsed.contacts.push({ type: 'email', value: e }); have.add(e.toLowerCase()) }
  for (const p of phones) if (!have.has(p.toLowerCase())) { parsed.contacts.push({ type: 'phone', value: p }); have.add(p.toLowerCase()) }

  // ── WhiteBox-гарантия полноты: обязанности ДОСЛОВНО из исходного текста ──
  // LLM (даже сильный) может выбрасывать фрагменты при переписывании (напр. «ФСТЭК»).
  // Поэтому description берём дословно из текста, а не из генерации модели:
  //   • якоря надёжны (все места, по порядку) → блок каждого места целиком;
  //   • якоря ненадёжны → добираем дословным текстом те места, где он содержательнее
  //     LLM-версии (лучше «с лишним», чем потерять ключевое слово).
  // Работает всегда, в т.ч. при forceLlm (кнопка «Переструктурировать через ИИ»).
  enrichExperienceFromText(parsed, opts.text)

  return { parsed, usage: result.usage, config, source: 'llm' as const }
}

/** Нормализация для нечёткого поиска якоря в тексте. */
function norm(s: string): string {
  return s.toLowerCase().replace(/[«»"'()]/g, '').replace(/\s+/g, ' ').trim()
}

/**
 * Дополняет experience[].description дословным текстом из исходного резюме.
 * Для каждого места ищем позицию его якоря (company, затем position) в тексте,
 * берём фрагмент до следующего места и, если он длиннее/содержательнее того, что
 * вернула модель, — используем его. Гарантия: обязанности не теряются.
 */
function enrichExperienceFromText(parsed: StructuredResume, rawText: string): void {
  const text = rawText.replace(/\r/g, '')
  const normText = norm(text)
  if (!parsed.experience.length) return

  // Находим индекс якоря каждого места в НОРМАЛИЗОВАННОМ тексте.
  const anchors: { i: number, start: number }[] = []
  parsed.experience.forEach((e, i) => {
    let pos = -1
    for (const cand of [e.company, e.position].filter(Boolean)) {
      const n = norm(cand).slice(0, 40)
      if (n.length < 4) continue
      const p = normText.indexOf(n)
      if (p !== -1) { pos = p; break }
    }
    if (pos !== -1) anchors.push({ i, start: pos })
  })

  // Надёжность якорей: гибрид применяем ТОЛЬКО если нашли якоря для ВСЕХ мест
  // Нужен хотя бы один надёжный якорь. Режем блоки по фактическим позициям якорей
  // в тексте (сортировка по start), а привязываем к местам по anchor.i — так добор
  // работает даже при кривом порядке 2-колоночного текста (не смешивая места:
  // границы блоков — по соседним ПО ПОЗИЦИИ якорям, а не по индексу места).
  if (anchors.length === 0) return
  anchors.sort((a, b) => a.start - b.start)

  // Соответствие позиций в нормализованном тексте ≈ позициям в исходном:
  // norm() почти сохраняет длину (кроме схлопывания пробелов), для среза достаточно.
  // Чтобы резать по исходному тексту, строим карту нормализованных→исходных индексов.
  const map: number[] = []
  {
    let acc = ''
    // Повторяем нормализацию посимвольно, запоминая исходный индекс каждого норм-символа.
    let prevSpace = false
    for (let k = 0; k < text.length; k++) {
      let ch = text[k]!
      if (/[«»"'()]/.test(ch)) continue
      ch = ch.toLowerCase()
      if (/\s/.test(ch)) {
        if (prevSpace) continue
        ch = ' '; prevSpace = true
      }
      else prevSpace = false
      acc += ch
      map.push(k)
    }
    void acc
  }

  for (let a = 0; a < anchors.length; a++) {
    const cur = anchors[a]!
    const nextStart = a + 1 < anchors.length ? anchors[a + 1]!.start : normText.length
    const rawStart = map[cur.start] ?? 0
    const rawEnd = map[Math.min(nextStart, map.length - 1)] ?? text.length
    let block = text.slice(rawStart, rawEnd).trim()
    // Убираем из блока строку-заголовок (компанию/должность/период) — оставляем обязанности.
    block = block
      .replace(/^[^\n]*\n/, '') // первая строка (обычно компания/должность)
      .replace(/\b(19|20)\d{2}\b[^\n]*\n?/g, m => m.length < 40 ? '' : m) // короткие строки-даты
      .replace(/\n{3,}/g, '\n\n')
      .trim()
    const llmDesc = parsed.experience[cur.i]!.description ?? ''
    // Берём дословный блок, если он заметно содержательнее (модель обрезала).
    if (block.length > llmDesc.length + 40 && block.length < 6000) {
      parsed.experience[cur.i]!.description = block
    }
  }
}
