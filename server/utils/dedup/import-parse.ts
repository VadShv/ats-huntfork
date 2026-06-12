/**
 * Парсер CSV и XLSX файлов для массового импорта кандидатов (Sprint 5.4, P5.4).
 *
 * Поддерживает гибкие заголовки: lastName | last_name | Фамилия | фамилия, и т.д.
 * Возвращает массив `ParsedCandidateRow` для дальнейшей дедуп-проверки.
 */
import Papa from 'papaparse'
import ExcelJS from 'exceljs'

export interface ParsedCandidateRow {
  /** Номер строки в исходном файле (с заголовком = 1, т.е. данные начинаются с 2). */
  rowNumber: number
  firstName: string | null
  lastName: string | null
  email: string | null
  phone: string | null
  dateOfBirth: string | null
  city: string | null
  linkedin: string | null
  telegram: string | null
  github: string | null
  /** Все исходные поля строки — на случай если рекрутер хочет их посмотреть. */
  raw: Record<string, string>
  /** Ошибки парсинга строки (пустые обязательные поля и т.п.). */
  errors: string[]
}

/**
 * Маппинг возможных названий колонок → внутренние ключи.
 * Все ключи в lower-case с заменой не-буквенных на пустую строку.
 */
const HEADER_MAP: Record<string, keyof Omit<ParsedCandidateRow, 'rowNumber' | 'raw' | 'errors'>> = {
  // First name
  firstname: 'firstName',
  first_name: 'firstName',
  имя: 'firstName',
  имякандидата: 'firstName',
  // Last name
  lastname: 'lastName',
  last_name: 'lastName',
  фамилия: 'lastName',
  // Email
  email: 'email',
  mail: 'email',
  почта: 'email',
  // Phone
  phone: 'phone',
  телефон: 'phone',
  mobile: 'phone',
  // DOB
  dateofbirth: 'dateOfBirth',
  date_of_birth: 'dateOfBirth',
  dob: 'dateOfBirth',
  birthday: 'dateOfBirth',
  деньрождения: 'dateOfBirth',
  датарождения: 'dateOfBirth',
  // City
  city: 'city',
  город: 'city',
  // LinkedIn
  linkedin: 'linkedin',
  // Telegram
  telegram: 'telegram',
  tg: 'telegram',
  // GitHub
  github: 'github',
  gh: 'github',
}

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[^a-z0-9а-яё_]/giu, '')
}

function emptyToNull(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s.length === 0 ? null : s
}

/**
 * Преобразует одну строку (Record<header, value>) в ParsedCandidateRow.
 */
function parseRow(rowNum: number, row: Record<string, string>): ParsedCandidateRow {
  const out: ParsedCandidateRow = {
    rowNumber: rowNum,
    firstName: null,
    lastName: null,
    email: null,
    phone: null,
    dateOfBirth: null,
    city: null,
    linkedin: null,
    telegram: null,
    github: null,
    raw: row,
    errors: [],
  }

  for (const [k, v] of Object.entries(row)) {
    const headerKey = normalizeHeader(k)
    const field = HEADER_MAP[headerKey]
    if (!field) continue
    const value = emptyToNull(v)
    if (value !== null) {
      (out as any)[field] = value
    }
  }

  // Валидация обязательных полей
  if (!out.firstName) out.errors.push('Не указано имя')
  if (!out.lastName) out.errors.push('Не указана фамилия')
  if (!out.email) out.errors.push('Не указан email')

  // Простая валидация email
  if (out.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email)) {
    out.errors.push('Некорректный email')
  }

  // Простая валидация даты: ISO YYYY-MM-DD
  if (out.dateOfBirth) {
    const dob = out.dateOfBirth.trim()
    // Допустим DD.MM.YYYY → конвертируем в YYYY-MM-DD
    const m = dob.match(/^(\d{2})[./-](\d{2})[./-](\d{4})$/)
    if (m) {
      out.dateOfBirth = `${m[3]}-${m[2]}-${m[1]}`
    }
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
      out.errors.push(`Дата рождения "${dob}" не в формате YYYY-MM-DD или DD.MM.YYYY`)
      out.dateOfBirth = null
    }
  }

  return out
}

/**
 * Парсит CSV-файл (любая кодировка приходит как Buffer → toString('utf8') с BOM-стрипом).
 */
export function parseCsv(buffer: Buffer): ParsedCandidateRow[] {
  let text = buffer.toString('utf8')
  // Strip BOM
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1)

  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: h => h.trim(),
  })

  if (result.errors && result.errors.length > 0) {
    // Логируем только первую ошибку, остальные строки парсим best-effort
    console.warn('[import-parse] CSV parse warnings:', result.errors.slice(0, 3))
  }

  return result.data.map((row, idx) => parseRow(idx + 2, row))
}

/**
 * Парсит XLSX-файл. Берёт первый лист.
 */
export async function parseXlsx(buffer: Buffer): Promise<ParsedCandidateRow[]> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer as any)
  const ws = wb.worksheets[0]
  if (!ws) return []

  const rows: ParsedCandidateRow[] = []
  let headers: string[] = []
  ws.eachRow((row, rowNumber) => {
    const values = row.values as Array<string | number | null | undefined>
    // ExcelJS values массив 1-индексированный (values[0] === undefined)
    const cells = values.slice(1).map(v => (v === null || v === undefined ? '' : String(v)))
    if (rowNumber === 1) {
      headers = cells.map(h => h.trim())
      return
    }
    const obj: Record<string, string> = {}
    for (let i = 0; i < headers.length; i++) {
      obj[headers[i]!] = cells[i] ?? ''
    }
    rows.push(parseRow(rowNumber, obj))
  })

  return rows
}
