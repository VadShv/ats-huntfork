import { fileTypeFromBuffer } from 'file-type'
import {
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE,
} from '../../utils/schemas/document'
import { parseDocument } from '../../utils/resume-parser'

/**
 * POST /api/documents/parse-preview
 *
 * Parses an uploaded resume file and returns extracted contact fields
 * for auto-filling the "New Candidate" form.
 *
 * Accepts multipart/form-data with:
 *   - `file`: PDF, DOC, or DOCX (max 10 MB)
 *
 * Returns JSON:
 *   { firstName, lastName, displayName?, email?, phone?,
 *     textPreview, wordCount, sourceFormat }
 *
 * Security:
 *   - Requires candidate:create permission
 *   - MIME validated via magic bytes (file-type)
 *   - File is NOT saved — parse only
 */
export default defineEventHandler(async (event) => {
  // ─────────────────────────────────────────────
  // 1. Auth — recruiter must be able to create candidates
  // ─────────────────────────────────────────────
  await requirePermission(event, { candidate: ['create'] })

  // ─────────────────────────────────────────────
  // 2. Read multipart form data
  // ─────────────────────────────────────────────
  const formData = await readMultipartFormData(event)
  if (!formData) {
    throw createError({ statusCode: 400, statusMessage: 'Данные формы не получены' })
  }

  const filePart = formData.find((part) => part.name === 'file')
  if (!filePart || !filePart.data || !filePart.filename) {
    throw createError({ statusCode: 400, statusMessage: 'Файл не выбран' })
  }

  // ─────────────────────────────────────────────
  // 3. Validate file size
  // ─────────────────────────────────────────────
  const fileBuffer = filePart.data
  if (fileBuffer.length > MAX_FILE_SIZE) {
    throw createError({
      statusCode: 413,
      statusMessage: `Файл слишком большой. Максимальный размер: ${MAX_FILE_SIZE / 1024 / 1024} МБ`,
    })
  }

  // ─────────────────────────────────────────────
  // 4. Validate MIME type via magic bytes
  // ─────────────────────────────────────────────
  const detectedType = await fileTypeFromBuffer(fileBuffer)
  let mimeType = detectedType?.mime

  // file-type cannot reliably detect legacy .doc (OLE2 compound) — check magic bytes manually
  if (!mimeType) {
    // OLE2 compound document magic: D0 CF 11 E0 A1 B1 1A E1
    const ole2Magic = Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1])
    const fileStart = fileBuffer.slice(0, 8)
    if (fileStart.equals(ole2Magic)) {
      mimeType = 'application/msword'
    }
  }

  if (!mimeType || !(ALLOWED_MIME_TYPES as readonly string[]).includes(mimeType)) {
    throw createError({
      statusCode: 415,
      statusMessage: 'Неподдерживаемый тип файла. Разрешены только файлы PDF, DOC и DOCX',
    })
  }

  // ─────────────────────────────────────────────
  // 5. Parse document (best-effort — no file saved)
  // ─────────────────────────────────────────────
  const parsed = await parseDocument(fileBuffer, mimeType, filePart.filename)

  if (!parsed || !parsed.text) {
    throw createError({
      statusCode: 422,
      statusMessage: 'Не удалось извлечь текст из документа',
    })
  }

  const { text, metadata } = parsed

  // ─────────────────────────────────────────────
  // 6. Extract contacts via regex
  // ─────────────────────────────────────────────

  // Email
  const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)
  const email = emailMatch?.[0] ?? undefined

  // Phone — Russian formats: +7 (XXX) XXX-XX-XX, +7XXXXXXXXXX, 8XXXXXXXXXX, etc.
  // Normalise to +7XXXXXXXXXX
  const phoneMatch = text.match(
    /(?:\+7|8)[\s\-]?\(?(\d{3})\)?[\s\-]?(\d{3})[\s\-]?(\d{2})[\s\-]?(\d{2})/,
  )
  let phone: string | undefined
  if (phoneMatch) {
    const digits = `${phoneMatch[1]}${phoneMatch[2]}${phoneMatch[3]}${phoneMatch[4]}`
    phone = `+7${digits}`
  }

  // Дата рождения: «родился/родилась 1 февраля 1987» | «Дата рождения 29 августа 1983».
  const MONTHS_RU: Record<string, number> = {
    'января': 1, 'февраля': 2, 'марта': 3, 'апреля': 4, 'мая': 5, 'июня': 6,
    'июля': 7, 'августа': 8, 'сентября': 9, 'октября': 10, 'ноября': 11, 'декабря': 12,
  }
  let dateOfBirth: string | undefined
  const dobMatch = text.match(/(?:родил(?:ся|ась)|дата рождения)\s+(\d{1,2})\s+([а-яё]+)\s+(\d{4})/i)
  if (dobMatch) {
    const mon = MONTHS_RU[dobMatch[2]!.toLowerCase()]
    if (mon) dateOfBirth = `${dobMatch[3]}-${String(mon).padStart(2, '0')}-${dobMatch[1]!.padStart(2, '0')}`
  }

  // Пол: «Мужчина/Женщина» или «Мужской/Женский пол». (Без \b — не работает с кириллицей.)
  let gender: 'male' | 'female' | undefined
  if (/(Мужчина|Мужской пол|Мужской)/i.test(text)) gender = 'male'
  else if (/(Женщина|Женский пол|Женский)/i.test(text)) gender = 'female'

  // Full name — first non-empty line that looks like 2–3 capitalised words
  // and is NOT a job title (директор, менеджер, разработчик, …)
  let firstName: string | undefined
  let lastName: string | undefined
  let displayName: string | undefined

  // Слова-маркеры должностей/заголовков — строки с ними не могут быть ФИО
  const JOB_TITLE_WORDS = new Set([
    'директор', 'менеджер', 'разработчик', 'инженер', 'консультант', 'руководитель',
    'специалист', 'аналитик', 'дизайнер', 'бухгалтер', 'администратор', 'программист',
    'тестировщик', 'архитектор', 'координатор', 'ассистент',
    'секретарь', 'оператор', 'контролер', 'кладовщик', 'курьер',
    'водитель', 'повар', 'электрик', 'слесарь', 'токарь',
    'маркетолог', 'копирайтер', 'редактор', 'журналист', 'переводчик',
    'юрист', 'адвокат', 'нотариус', 'следователь', 'прокурор', 'судья',
    'врач', 'медсестра', 'психолог', 'педагог', 'учитель', 'преподаватель',
    'экономист', 'финансист', 'брокер', 'агент', 'представитель',
    'коммерческий', 'технический', 'финансовый', 'операционный', 'креативный',
    'главный', 'старший', 'младший', 'ведущий', 'заместитель', 'зам',
    'начальник', 'заведующий', 'председатель', 'декан', 'ректор',
    'продавец', 'кассир', 'бариста', 'официант',
    // Заголовки-секции и служебные слова резюме
    'должность', 'желаемая', 'зарплата', 'резюме', 'контакты', 'опыт',
    'образование', 'навыки', 'портфолио', 'специализации', 'занятость',
  ])

  // Ограничиваем поиск: ФИО всегда до первой секции резюме
  const SECTION_RE = /^(experience|employment|education|skills|summary|profile|objective|about|contact|certifications?|awards?|languages?|interests?|references?|работа|опыт|образование|навыки|о\s+себе|контакты|обо\s+мне|цель|профиль)/i

  /**
   * Строка — «имя человека» (а не заголовок/должность), если каждое слово в
   * Title Case: заглавная + хотя бы одна строчная (Упоров, Виталий). Это ключевое
   * отличие от ALL-CAPS заголовков («ЖЕЛАЕМАЯ ДОЛЖНОСТЬ», «КОНТАКТЫ») и от
   * должностей. Разрешаем дефис (Римский-Корсаков) и букву Ё.
   */
  const NAME_WORD_RE = /^[A-ZА-ЯЁ][a-zа-яё]+(?:-[A-ZА-ЯЁ][a-zа-яё]+)?$/

  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  const sectionIdx = lines.findIndex((l) => SECTION_RE.test(l) && l.length < 60)
  // Ищем шире (до 25 строк / до секции) — в кастомных макетах ФИО бывает не в самом верху.
  const searchLines = lines.slice(0, sectionIdx > 0 ? Math.min(sectionIdx, 25) : 20)

  for (const line of searchLines) {
    if (email && line.includes(email)) continue
    if (/https?:\/\/|www\.|@/.test(line)) continue
    if (/\d/.test(line)) continue // в ФИО не бывает цифр
    if (line.length > 50) continue

    const words = line.split(/\s+/)
    if (words.length < 2 || words.length > 3) continue

    // Каждое слово — в Title Case (не ALL-CAPS заголовок, не строчное).
    if (!words.every(w => NAME_WORD_RE.test(w))) continue

    // Пропускаем должности/заголовки по ключевым словам.
    const lowerWords = words.map(w => w.toLowerCase())
    if (lowerWords.some(w => JOB_TITLE_WORDS.has(w))) continue

    // Похоже на ФИО — берём. Русское резюме: обычно «Фамилия Имя Отчество».
    if (words.length === 2) {
      // «Упоров Виталий» → фамилия первой (частый порядок в РФ-резюме).
      lastName = words[0]
      firstName = words[1]
      displayName = line
    }
    else {
      lastName = words[0]
      firstName = words[1]
      displayName = line
    }
    break
  }

  // ─────────────────────────────────────────────
  // 7. Return result (no file saved)
  // ─────────────────────────────────────────────
  return {
    firstName,
    lastName,
    displayName,
    dateOfBirth,
    gender,
    email,
    phone,
    textPreview: text.slice(0, 500),
    wordCount: metadata.wordCount,
    sourceFormat: metadata.sourceFormat,
  }
})
