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

  // ── Индексы начал периодов ──
  const starts: number[] = []
  for (let i = 0; i < expLines.length; i++) {
    if (isPeriodStart(expLines[i]!)) starts.push(i)
  }
  if (starts.length === 0) return null // не смогли распознать опыт → LLM

  const experience: StructuredResume['experience'] = []
  for (let s = 0; s < starts.length; s++) {
    const blockStart = starts[s]!
    const blockEnd = s + 1 < starts.length ? starts[s + 1]! : expLines.length
    const block = expLines.slice(blockStart, blockEnd)

    // block[0] = «Февраль 2023 —» (возможно с концом на той же строке)
    const startLine = block[0]!
    const start = parseMonthYear(startLine) ?? ''
    // Конец: остаток строки после «—» или следующая строка.
    let end = ''
    const dashRest = startLine.split(/[—–-]/).slice(1).join('-').trim()
    let cursor = 1
    if (dashRest && !/настоящее время/i.test(dashRest)) {
      end = parseMonthYear(dashRest) ?? ''
    }
    else if (!dashRest && block[1]) {
      // конец на отдельной строке
      if (/настоящее время/i.test(block[1]!)) { end = ''; cursor = 2 }
      else { end = parseMonthYear(block[1]!) ?? ''; cursor = block[1] && parseMonthYear(block[1]!) ? 2 : 1 }
    }

    // Компания — первая значимая строка после дат.
    let company = ''
    while (cursor < block.length) {
      const l = block[cursor]!
      cursor++
      if (!l) continue
      if (/настоящее время/i.test(l)) continue
      company = cleanCompany(l)
      break
    }

    // После компании в hh идёт блок «мета» — локация/сайт + сфера деятельности
    // с буллетами «•», — и ТОЛЬКО потом должность, затем обязанности.
    // Алгоритм: пропускаем мета-строки (локация, буллеты, индустрии) и берём
    // ПОСЛЕДНЮЮ строку перед первой строкой-обязанностью как должность.
    //   - мета-строка: начинается с «•», или содержит www./http, или это «сфера»
    //     (одна строка без завершающей пунктуации, часто с запятыми-перечислением);
    //   - должность: короткая строка (≤80) прямо перед содержательным текстом.
    const rest: string[] = []
    for (; cursor < block.length; cursor++) rest.push(block[cursor]!)

    // Индекс, с которого начинается «мясо» обязанностей: первая строка,
    // оканчивающаяся точкой/двоеточием или длиннее 80 символов, или буллет-детализация.
    let dutiesStart = -1
    for (let i = 0; i < rest.length; i++) {
      const l = rest[i]!
      if (!l) continue
      const isMeta = /^•/.test(l) || /www\.|http/i.test(l)
      const looksLikeDuty = l.length > 80 || /[.:]$/.test(l) || /^(Ключевые|Руководство|Управление|Отвечал|Создание|Развитие|Вывод|Обеспеч|Внедр|Организ)/i.test(l)
      if (!isMeta && looksLikeDuty) { dutiesStart = i; break }
    }

    let position = ''
    let descLines: string[] = []
    if (dutiesStart > 0) {
      // Должность — последняя НЕ мета/НЕ буллет строка перед обязанностями.
      for (let i = dutiesStart - 1; i >= 0; i--) {
        const l = rest[i]!
        if (!l) continue
        if (/^•/.test(l) || /www\.|http/i.test(l)) continue
        position = l
        break
      }
      descLines = rest.slice(dutiesStart)
    }
    else {
      // Не нашли явных обязанностей — первая содержательная строка = должность.
      const firstIdx = rest.findIndex(l => l && !/^•/.test(l) && !/www\.|http/i.test(l))
      if (firstIdx >= 0) { position = rest[firstIdx]!; descLines = rest.slice(firstIdx + 1) }
    }

    // Чистка должности: убрать префиксы-метки, отбросить «StartUp»/проектные метки.
    position = position.replace(/^(ключевая роль|роль|должность)\s*[:—-]\s*/i, '').trim()
    if (/^(startup|стартап|проект)\b/i.test(position) && descLines.length) {
      // «StartUp» — не должность; попробуем взять первую строку описания как роль,
      // если она короткая и без завершающей точки.
      const cand = descLines.find(l => l && l.length < 60 && !/[.:]$/.test(l))
      if (cand) position = cand
    }

    const description = descLines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
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
