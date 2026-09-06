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

  // ── Образование ──
  // hh выводит секцию «Образование» в двух вариантах:
  //   (полный)   Образование / <Уровень> / <Год> / <Уровень> / <ВУЗ, город> / <специальность>
  //   (краткий)  Образование / Уровень Высшее образование, <специальность>   — без ВУЗа (Мездриков)
  const education: StructuredResume['education'] = []
  const eduIdx = lines.findIndex(l => /^(образование|высшее образование)$/i.test(l))
  if (eduIdx !== -1) {
    // Границы секции — до следующей секции резюме.
    let eduEnd = lines.length
    for (let i = eduIdx + 1; i < lines.length; i++) {
      if (SECTION_RE.test(lines[i]!) && !/^высшее образование$/i.test(lines[i]!)) { eduEnd = i; break }
      if (/^(навыки|знание языков|дополнительная информация|гражданство|повышение квалификации|электронные сертификаты)/i.test(lines[i]!)) { eduEnd = i; break }
    }
    const eduLines = lines.slice(eduIdx + 1, eduEnd).filter(Boolean)
    const LEVEL_RE = /(высшее|неоконченное высшее|среднее специальное|среднее|бакалавр|магистр|специалитет|аспирантура|MBA)/i
    const UNIVERSITY_RE = /(университет|институт|академия|колледж|школа экономики|техникум|училище|university|institute|college|МГУ|МГТУ|МФТИ|ВШЭ|РЭУ|РАНХиГС)/i

    // Краткий вариант: одна строка «Уровень Высшее образование, <специальность>».
    const shortLine = eduLines.find(l => /^уровень\s+/i.test(l) || (LEVEL_RE.test(l) && l.includes(',')))
    const uniLines = eduLines.filter(l => UNIVERSITY_RE.test(l))

    if (uniLines.length === 0 && shortLine) {
      // Только уровень + специальность, без ВУЗа.
      const cleaned = shortLine.replace(/^уровень\s+/i, '')
      const parts = cleaned.split(',')
      const result = parts[0]?.trim() ?? '' // «Высшее образование»
      const name = parts.slice(1).join(',').trim() // специальность
      education.push({ organization: '', name, result, year: 0 })
    }
    else {
      // Полный вариант: по каждому ВУЗу собираем запись.
      const yearOf = (arr: string[], idx: number) => {
        for (let k = Math.max(0, idx - 3); k <= Math.min(arr.length - 1, idx + 1); k++) {
          const ym = arr[k]!.match(/\b(19|20)\d{2}\b/)
          if (ym) return Number.parseInt(ym[0], 10)
        }
        return 0
      }
      const levelNear = (arr: string[], idx: number) => {
        for (let k = Math.max(0, idx - 3); k < idx; k++) {
          if (LEVEL_RE.test(arr[k]!)) return arr[k]!.replace(/\n/g, ' ').trim()
        }
        return ''
      }
      eduLines.forEach((l, idx) => {
        if (!UNIVERSITY_RE.test(l)) return
        // Склейка названия ВУЗа, разорванного переносом PDF: если следующая строка —
        // продолжение (строчная буква / кавычка / «наук»), присоединяем её к org.
        let orgRaw = l
        let nameIdx = idx + 1
        const cont = eduLines[idx + 1]
        if (cont && /^([а-яё"«»]|наук|экономики|техники)/i.test(cont) && !LEVEL_RE.test(cont)) {
          orgRaw = `${l} ${cont}`
          nameIdx = idx + 2
        }
        // Убираем ведущий год («2013 Физический институт…») и хвостовой город.
        const organization = orgRaw
          .replace(/^\s*(19|20)\d{2}\s+/, '')
          .replace(/,\s*(Москва|Санкт-Петербург|[А-ЯЁ][а-яё-]+)\s*$/i, '')
          .trim()
        // специальность — строка после ВУЗа, если она не ВУЗ/уровень/год/город.
        let name = ''
        const next = eduLines[nameIdx]
        if (next && !UNIVERSITY_RE.test(next) && !LEVEL_RE.test(next) && !/^\d{4}$/.test(next)
          && !/^(Москва|Санкт-Петербург)/i.test(next)) {
          name = next.replace(/^[«"]?\s*/, '').trim()
        }
        education.push({ organization, name, result: levelNear(eduLines, idx), year: yearOf(eduLines, idx) })
      })
    }
  }

  return {
    firstName, lastName, middleName,
    title, birthDate, gender, area,
    salaryAmount: 0, salaryCurrency: '',
    totalExperienceMonths: 0, // посчитается из experience в buildHhCompatibleRaw
    experience, education, skills: skills.slice(0, 50), about,
    languages: [], contacts,
  }
}

/**
 * Второй детерминированный профиль — «портфолио»-макет (кастомные PDF, которые
 * НЕ являются экспортом hh.ru): секция «ПРОФЕССИОНАЛЬНЫЙ ОПЫТ», ФИО отдельной
 * строкой (не в самом верху), блок опыта в порядке:
 *   <Компания> / <Город> / <сфера> / <сайт> / <Должность> / <Период (в скобках)> / *обязанности
 * Период тут ПОСЛЕ должности и в одну строку: «Апрель 2022 — по настоящее время (…)».
 * Возвращает null при низкой уверенности → LLM.
 */
export function structurePortfolioResumeText(rawText: string): StructuredResume | null {
  const lines = rawText.split('\n').map(l => l.trim()).filter(l => !isNoiseLine(l) || l === '')

  const expIdx = lines.findIndex(l => /^профессиональный опыт$/i.test(l))
  if (expIdx === -1) return null

  // ФИО: строка «Фамилия Имя [Отчество]» Title Case до секции опыта, не заголовок капсом.
  const NAME_RE = /^[А-ЯЁ][а-яё]+(?:-[А-ЯЁ][а-яё]+)?(?:\s+[А-ЯЁ][а-яё]+){1,2}$/
  let firstName = '', lastName = '', middleName = ''
  for (const l of lines.slice(0, expIdx)) {
    if (!NAME_RE.test(l)) continue
    if (/должность|контакт|занятость|формат|опыт/i.test(l)) continue
    if (l === l.toUpperCase()) continue // ALL-CAPS заголовок
    const w = l.split(/\s+/)
    lastName = w[0]!; firstName = w[1]!; middleName = w[2] ?? ''
    break
  }
  if (!firstName || !lastName) return null

  // Контакты, желаемая должность, город/ДР/пол.
  const emailMatch = rawText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)
  const phoneMatch = rawText.match(/(?:\+7|8)[\s\-]?\(?(\d{3})\)?[\s\-]?(\d{3})[\s\-]?(\d{2})[\s\-]?(\d{2})/)
  const contacts: StructuredResume['contacts'] = []
  if (phoneMatch) contacts.push({ type: 'phone', value: `+7${phoneMatch[1]}${phoneMatch[2]}${phoneMatch[3]}${phoneMatch[4]}` })
  if (emailMatch) contacts.push({ type: 'email', value: emailMatch[0]! })

  let title = ''
  const tIdx = lines.findIndex(l => /^желаемая должность$/i.test(l))
  if (tIdx !== -1 && lines[tIdx + 1]) title = lines[tIdx + 1]!
  const birthMatch = rawText.match(/(?:родил[ся|ась]*|рождения)\s+(\d{1,2})\s+([а-яё]+)\s+(\d{4})/i)
  let birthDate = ''
  if (birthMatch) {
    const mon = MONTHS[birthMatch[2]!.toLowerCase()]
    if (mon) birthDate = `${birthMatch[3]}-${String(mon).padStart(2, '0')}-${birthMatch[1]!.padStart(2, '0')}`
  }
  const gender: StructuredResume['gender'] = /Мужск/i.test(rawText) ? 'male' : /Женск/i.test(rawText) ? 'female' : 'unknown'

  // Границы секции опыта: до следующей ALL-CAPS секции («ОБРАЗОВАНИЕ», «НАВЫКИ», …).
  let expEnd = lines.length
  for (let i = expIdx + 1; i < lines.length; i++) {
    if (/^[А-ЯЁ ]{6,}$/.test(lines[i]!) && /ОБРАЗОВАНИЕ|НАВЫКИ|КЛЮЧЕВЫЕ|ЯЗЫК|СЕРТИФИК|ДОСТИЖЕНИ|О СЕБЕ/i.test(lines[i]!)) { expEnd = i; break }
  }
  const expLines = lines.slice(expIdx + 1, expEnd)

  // Период вида «Апрель 2022 — по настоящее время (…)» / «Май 2018 — Январь 2020 (…)».
  const PERIOD_RE = /^([а-яё]+\s+\d{4})\s*[—–-]\s*(по настоящее время|[а-яё]+\s+\d{4})/i
  const periodIdxs: number[] = []
  for (let i = 0; i < expLines.length; i++) if (PERIOD_RE.test(expLines[i]!)) periodIdxs.push(i)
  if (periodIdxs.length === 0) return null

  const experience: StructuredResume['experience'] = []
  for (let p = 0; p < periodIdxs.length; p++) {
    const periodIdx = periodIdxs[p]!
    // Блок компании: от конца пред. обязанностей до этого периода — здесь компания/сфера/должность.
    const headStart = p === 0 ? 0 : periodIdxs[p - 1]! + 1
    // Обязанности: строки после периода до следующего периода (за вычетом хвостовых ФИО-колонтитулов).
    const dutiesEnd = p + 1 < periodIdxs.length
      ? findHeadStartBefore(expLines, periodIdxs[p + 1]!)
      : expLines.length

    const m = expLines[periodIdx]!.match(PERIOD_RE)!
    const start = parseMonthYear(m[1]!) ?? ''
    const end = /настоящее время/i.test(m[2]!) ? '' : (parseMonthYear(m[2]!) ?? '')

    // Голова блока: [Компания, Город, сфера, сайт, Должность]. Должность — последняя
    // не-мета строка перед периодом; компания — первая не-мета строка головы.
    const head = expLines.slice(headStart, periodIdx).filter(Boolean)
    const isMeta = (l: string) => /^•|\*/.test(l) || /www\.|http/i.test(l)
      || /(информационные технологии|телекоммуникац|системная интеграц|розничн|оптов|производство|фармацевт|медицин|консалтинг|связь|интернет|торговл|интеграц|радиоэлектрон|электрооборуд|автоматиз)/i.test(l)
      || /^(Москва|Санкт-Петербург|Одинцово|Казань|Новосибирск|Екатеринбург|Нижний|Самара|Ростов|Краснодар)/i.test(l)
    const nonMeta = head.filter(l => !isMeta(l))
    // Компания — первая не-мета строка головы, которая похожа на название (не хвост
    // обязанностей пред. места: не начинается со строчной буквы, без завершающей точки,
    // разумной длины).
    const looksLikeCompany = (l: string) => l.length < 80 && !/^[а-яё]/.test(l) && !/[.]$/.test(l)
    const company = cleanCompany(nonMeta.find(looksLikeCompany) ?? nonMeta[0] ?? head[0] ?? '')
    const position = nonMeta.length > 1 ? nonMeta[nonMeta.length - 1]! : (nonMeta[0] ?? '')

    // Обязанности: строки после периода, чистим ФИО-колонтитулы и звёздочки.
    const dutyLines = expLines.slice(periodIdx + 1, dutiesEnd)
      .filter(l => l && !new RegExp(`^${lastName}\\s+${firstName}`, 'i').test(l))
      .map(l => l.replace(/^\*\s*/, '• '))
    const description = dutyLines.join('\n').replace(/\n{3,}/g, '\n\n').trim()

    if ((company || position) && description.length > 15) {
      experience.push({ company: company === position ? '' : company, position, start, end, description })
    }
  }

  if (experience.length === 0) return null

  return {
    firstName, lastName, middleName,
    title, birthDate, gender, area: '',
    salaryAmount: 0, salaryCurrency: '',
    totalExperienceMonths: 0,
    experience, education: [], skills: [], about: '',
    languages: [], contacts,
  }
}

/** Начало «головы» следующего блока: отступаем от периода к строке-компании. */
function findHeadStartBefore(expLines: string[], nextPeriodIdx: number): number {
  // Голова следующего места — несколько строк перед его периодом; обязанности
  // текущего заканчиваются там, где начинается компания следующего. Эвристически
  // отступаем максимум 6 строк назад до первой «не-обязанности».
  let i = nextPeriodIdx - 1
  let steps = 0
  while (i > 0 && steps < 6) {
    const l = expLines[i]!
    if (/^\*|^•/.test(l) || l.length > 90) break // это ещё обязанность пред. места
    i--; steps++
  }
  return i + 1
}

/**
 * Единая точка детерминированного разбора: пробуем hh-формат, затем портфолио.
 * null → вызывающий использует LLM.
 */
export function structureResumeRuleBased(rawText: string): StructuredResume | null {
  return structureHhResumeText(rawText) ?? structurePortfolioResumeText(rawText)
}
