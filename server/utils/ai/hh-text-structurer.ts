/**
 * Детерминированный (rule-based) структуризатор текста hh.ru-резюме.
 *
 * hh экспортирует PDF с очень регулярной структурой, которую можно разложить
 * правилами БЕЗ LLM — моментально, с полными обязанностями и без галлюцинаций
 * (подход как у Huntflow для стандартных резюме). Для нестандартных макетов
 * (кастомные портфолио и т.п.) возвращаем null → вызывающий уходит в LLM-fallback.
 *
 * Возвращает StructuredResume (та же форма, что и LLM-путь) либо null, если текст
 * не распознан как hh-резюме с достаточной уверенностью.
 *
 * Структура блока опыта в hh-PDF:
 *   Опыт работы —16 лет 4 месяца        ← заголовок секции
 *   Февраль 2023 —                       ← начало (Месяц Год)
 *   настоящее время                      ← конец («настоящее время» | Месяц Год)
 *   1 год 6 месяцев                      ← длительность (игнорируем)
 *   билайн                               ← компания
 *   Москва, www.beeline.ru               ← город/сайт (опционально)
 *   [сфера деятельности, буллеты •]      ← описание компании (игнорируем)
 *   CPO (b2c)                            ← должность
 *   <обязанности...>                     ← description до следующей даты/секции
 */
import type { StructuredResume } from './structureResume'

const MONTHS: Record<string, number> = {
  'январь': 1, 'января': 1, 'февраль': 2, 'февраля': 2, 'март': 3, 'марта': 3,
  'апрель': 4, 'апреля': 4, 'май': 5, 'мая': 5, 'июнь': 6, 'июня': 6,
  'июль': 7, 'июля': 7, 'август': 8, 'августа': 8, 'сентябрь': 9, 'сентября': 9,
  'октябрь': 10, 'октября': 10, 'ноябрь': 11, 'ноября': 11, 'декабрь': 12, 'декабря': 12,
}

/** «Февраль 2023» → «2023-02-01»; null если не дата-строка. */
function parseMonthYear(line: string): string | null {
  const m = line.trim().toLowerCase().match(/^([а-яё]+)\s+(\d{4})/)
  if (!m) return null
  const mon = MONTHS[m[1]!]
  if (!mon) return null
  return `${m[2]}-${String(mon).padStart(2, '0')}-01`
}

/** Строка похожа на начало периода опыта: «Месяц Год —» или «Месяц Год - Месяц Год». */
function isPeriodStart(line: string): boolean {
  return /^[а-яё]+\s+\d{4}\s*[—–-]/i.test(line.trim())
}

/** Служебные строки hh-PDF: разрывы страниц, колонтитулы, длительности. */
function isNoiseLine(line: string): boolean {
  const t = line.trim()
  if (!t) return true
  if (/^--\s*\d+\s+of\s+\d+\s*--$/i.test(t)) return true // «-- 1 of 8 --»
  if (/резюме обновлено/i.test(t)) return true // колонтитул
  if (/^\d+\s+(год|года|лет)(\s+\d+\s+месяц)?/i.test(t)) return true // «1 год 6 месяцев»
  if (/^\d+\s+месяц/i.test(t)) return true
  return false
}

const SECTION_RE = /^(опыт работы|образование|ключевые навыки|обо мне|о себе|дополнительная информация|знание языков|повышение квалификации|тесты|электронные сертификаты|высшее образование)/i

/** «билайн (2 года)» → «билайн»; убираем хвостовую скобку с длительностью. */
function cleanCompany(line: string): string {
  return line.replace(/\s*\([^)]*(?:год|года|лет|месяц)[^)]*\)\s*$/i, '').trim()
}

/**
 * Пытается детерминированно разобрать hh-резюме. Возвращает null при низкой
 * уверенности (не hh-формат) — тогда вызывающий использует LLM.
 */
export function structureHhResumeText(rawText: string): StructuredResume | null {
  const allLines = rawText.split('\n').map(l => l.trim())
  // Убираем шум, но сохраняем пустые как разделители абзацев описания.
  const lines = allLines.filter(l => !isNoiseLine(l) || l === '')

  // ── Маркер hh: наличие секции «Опыт работы —N лет» ──
  const expHeaderIdx = lines.findIndex(l => /^опыт работы\s*[—–-]/i.test(l))
  if (expHeaderIdx === -1) return null

  // ── ФИО: в hh-PDF идёт одной из первых строк, Title Case, 2-3 слова ──
  const NAME_RE = /^[А-ЯЁ][а-яё]+(?:-[А-ЯЁ][а-яё]+)?(?:\s+[А-ЯЁ][а-яё]+){1,2}$/
  let firstName = '', lastName = '', middleName = ''
  for (const l of lines.slice(0, Math.min(expHeaderIdx, 12))) {
    if (!NAME_RE.test(l)) continue
    if (/резюме|должность|зарплата|контакт/i.test(l)) continue
    const w = l.split(/\s+/)
    lastName = w[0]!; firstName = w[1]!; middleName = w[2] ?? ''
    break
  }
  // Без имени не доверяем rule-based → LLM.
  if (!firstName || !lastName) return null

  // ── Контакты ──
  const emailMatch = rawText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)
  const phoneMatch = rawText.match(/(?:\+7|8)[\s\-]?\(?(\d{3})\)?[\s\-]?(\d{3})[\s\-]?(\d{2})[\s\-]?(\d{2})/)
  const contacts: StructuredResume['contacts'] = []
  if (phoneMatch) contacts.push({ type: 'phone', value: `+7${phoneMatch[1]}${phoneMatch[2]}${phoneMatch[3]}${phoneMatch[4]}` })
  if (emailMatch) contacts.push({ type: 'email', value: emailMatch[0]! })

  // ── Желаемая должность: строка «Желаемая должность» → следующая значимая ──
  let title = ''
  const titleIdx = lines.findIndex(l => /^желаемая должность/i.test(l))
  if (titleIdx !== -1) {
    for (let i = titleIdx + 1; i < Math.min(titleIdx + 4, lines.length); i++) {
      if (lines[i] && !/специализаци|занятость|график/i.test(lines[i]!)) { title = lines[i]!; break }
    }
  }

  // ── Город/возраст/пол из шапки ──
  const areaMatch = rawText.match(/Проживает:\s*([^\n,]+)/i)
  const area = areaMatch?.[1]?.trim() ?? ''
  const birthMatch = rawText.match(/родился\s+(\d{1,2})\s+([а-яё]+)\s+(\d{4})/i)
  let birthDate = ''
  if (birthMatch) {
    const mon = MONTHS[birthMatch[2]!.toLowerCase()]
    if (mon) birthDate = `${birthMatch[3]}-${String(mon).padStart(2, '0')}-${birthMatch[1]!.padStart(2, '0')}`
  }
  const gender: StructuredResume['gender'] = /Мужчина|Мужской/i.test(rawText)
    ? 'male'
    : /Женщина|Женский/i.test(rawText) ? 'female' : 'unknown'

  // ── Границы секции опыта: от заголовка до следующей секции ──
  let expEnd = lines.length
  for (let i = expHeaderIdx + 1; i < lines.length; i++) {
    if (SECTION_RE.test(lines[i]!) && !/^опыт работы/i.test(lines[i]!)) { expEnd = i; break }
  }
  const expLines = lines.slice(expHeaderIdx + 1, expEnd)

  // ── Токенизация блока опыта на «периоды» и «контент» между ними ──
  // Место работы начинается с блока дат (1+ дата-строк подряд + опц. длительность),
  // затем контент (компания, сфера, должность, обязанности) до следующего блока дат.
  const isDurationLine = (l: string) => /^\d+\s+(год|года|лет|месяц|месяца|месяцев)/i.test(l.trim())
  const isDateLine = (l: string) => /^[а-яё]+\s+\d{4}\b/i.test(l.trim()) || /настоящее время/i.test(l.trim())
  // Строка-«сфера деятельности» компании: перечисление индустрий (не должность/обязанность).
  const isIndustryLine = (l: string) =>
    /(информационные технологии|телекоммуникац|системная интеграц|розничн|оптов|производство|фармацевт|медицин|консалтинг|связь|интернет|торговл|банк|страхован|недвижимост|логистик|автоматизац|радиоэлектроник|микроэлектроник)/i.test(l)
    && !/[.]$/.test(l.trim())

  // Собираем индексы, где начинается блок дат.
  const periodStarts: number[] = []
  for (let i = 0; i < expLines.length; i++) {
    const l = expLines[i]!
    if (/^[а-яё]+\s+\d{4}\s*[—–-]?\s*$/i.test(l.trim()) || /^[а-яё]+\s+\d{4}\s*[—–-]\s*[а-яё]/i.test(l.trim())) {
      // Начало периода — но только если предыдущая значимая строка НЕ дата
      // (иначе это конец предыдущего периода на отдельной строке).
      let prev = i - 1
      while (prev >= 0 && !expLines[prev]!) prev--
      const prevIsDate = prev >= 0 && (isDateLine(expLines[prev]!) || isDurationLine(expLines[prev]!))
      if (!prevIsDate) periodStarts.push(i)
    }
  }
  if (periodStarts.length === 0) return null

  const experience: StructuredResume['experience'] = []
  for (let s = 0; s < periodStarts.length; s++) {
    const blockStart = periodStarts[s]!
    const blockEnd = s + 1 < periodStarts.length ? periodStarts[s + 1]! : expLines.length
    const block = expLines.slice(blockStart, blockEnd)

    // 1) Съедаем ведущие строки дат/длительностей → start (первая дата), end (последняя дата).
    const dateBuf: string[] = []
    let cursor = 0
    while (cursor < block.length) {
      const l = block[cursor]!
      if (!l) { cursor++; continue }
      // строка вида «Месяц Год — Месяц Год» или «Месяц Год —» или «Месяц Год» или «настоящее время» или длительность
      if (isDateLine(l) || isDurationLine(l) || /^[а-яё]+\s+\d{4}\s*[—–-]/i.test(l)) {
        dateBuf.push(l); cursor++; continue
      }
      break
    }
    // Разбираем даты: все MonthYear токены из dateBuf.
    const monthYears: string[] = []
    let hasPresent = false
    for (const dl of dateBuf) {
      for (const part of dl.split(/[—–-]/)) {
        const my = parseMonthYear(part)
        if (my) monthYears.push(my)
        if (/настоящее время/i.test(part)) hasPresent = true
      }
    }
    const start = monthYears[0] ?? ''
    const end = hasPresent ? '' : (monthYears.length > 1 ? monthYears[monthYears.length - 1]! : '')

    // 2) Контент после дат: компания, [город/сайт], [сфера/буллеты], должность, обязанности.
    const rest = block.slice(cursor).map(l => l).filter((l, idx, arr) => !(l === '' && arr[idx - 1] === ''))

    // Компания — первая значимая строка, не год/дата/длительность.
    let ci = rest.findIndex(l => l && !isDateLine(l) && !isDurationLine(l) && !/^\d{4}$/.test(l))
    let company = ci >= 0 ? cleanCompany(rest[ci]!) : ''

    // Контент после компании: [город/сайт] [сфера/буллеты] ДОЛЖНОСТЬ обязанности...
    const after = ci >= 0 ? rest.slice(ci + 1) : rest

    // Должностные маркеры — самый надёжный сигнал позиции в hh.
    const TITLE_WORDS = /(директор|руководител|менеджер|специалист|инженер|аналитик|консультант|начальник|заместитель|глава|head|lead|manager|owner|CxO|CEO|CFO|CTO|COO|CCO|CPO|CIO|президент|вице-президент|управляющ|архитектор|разработчик|продавец|администратор|координатор|эксперт|партн[её]р|founder|основатель|стажёр|стажер|ассистент|бизнес-|product|project|sales|account)/i
    const isMeta = (l: string) => !l || /^•/.test(l) || /www\.|http/i.test(l) || isIndustryLine(l)
      || /^(Москва|Санкт-Петербург|Казань|Новосибирск|Екатеринбург|Нижний|Самара|Ростов|Краснодар|Уфа|Пермь|Воронеж|Волгоград|Томск)/i.test(l)

    // 1) Ищем строку-должность: содержит должностной маркер, коротка (<90), без концевой точки.
    let posIdx = after.findIndex(l => l && !/^•/.test(l) && l.length < 90 && !/[.]$/.test(l) && TITLE_WORDS.test(l) && !isIndustryLine(l))

    // 2) Фолбэк: если не нашли по маркеру — последняя не-мета строка перед первой «обязанностью».
    if (posIdx === -1) {
      const dutiesStart = after.findIndex(l => l && (/^•/.test(l) || l.length > 70 || /[.:]$/.test(l)))
      if (dutiesStart > 0) {
        for (let i = dutiesStart - 1; i >= 0; i--) {
          if (!isMeta(after[i]!)) { posIdx = i; break }
        }
      }
    }

    let position = ''
    let descLines: string[] = []
    if (posIdx >= 0) {
      position = after[posIdx]!
      descLines = after.slice(posIdx + 1)
    }
    else {
      // совсем не нашли — всё после меты в описание
      const fi = after.findIndex(l => !isMeta(l))
      descLines = fi >= 0 ? after.slice(fi) : after
    }

    // Чистка должности.
    position = position.replace(/^(ключевая роль|роль|должность)\s*[:—-]\s*/i, '').trim()

    // Описание: выкидываем оставшиеся мета-строки (сфера, буллеты индустрий, локация).
    const description = descLines.filter(l => !isIndustryLine(l)).join('\n').replace(/\n{3,}/g, '\n\n').trim()
    if (company || position) {
      experience.push({ company, position, start, end, description })
    }
  }

  // Если ни у одного места нет описания — вероятно, распознали плохо → LLM.
  const withDesc = experience.filter(e => e.description.length > 20).length
  if (experience.length === 0 || withDesc === 0) return null

  // ── Навыки ──
  const skills: string[] = []
  const skillsIdx = lines.findIndex(l => /^ключевые навыки/i.test(l))
  if (skillsIdx !== -1) {
    for (let i = skillsIdx + 1; i < Math.min(skillsIdx + 40, lines.length); i++) {
      const l = lines[i]!
      if (!l) continue
      if (SECTION_RE.test(l)) break
      // навыки в hh идут тегами через строки/запятые
      l.split(/[,;•]/).map(s => s.trim()).filter(s => s.length > 1 && s.length < 40).forEach(s => skills.push(s))
    }
  }

  // ── О себе ──
  let about = ''
  const aboutIdx = lines.findIndex(l => /^обо мне|^о себе/i.test(l))
  if (aboutIdx !== -1) {
    const buf: string[] = []
    for (let i = aboutIdx + 1; i < lines.length; i++) {
      if (SECTION_RE.test(lines[i]!)) break
      buf.push(lines[i]!)
    }
    about = buf.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  }

  return {
    firstName, lastName, middleName,
    title, birthDate, gender, area,
    salaryAmount: 0, salaryCurrency: '',
    totalExperienceMonths: 0, // посчитается из experience в buildHhCompatibleRaw
    experience, education: [], skills: skills.slice(0, 50), about,
    languages: [], contacts,
  }
}
