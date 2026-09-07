/**
 * Resume Parser
 *
 * Extracts text content from uploaded documents (PDF, DOCX, DOC).
 * Returns structured parsed content for storage in document.parsedContent.
 *
 * Supports:
 *   - PDF — via pdf-parse (pdfjs-dist based)
 *   - DOCX — via mammoth (XML-based, reliable)
 *   - DOC — via word-extractor (OLE2 compound documents)
 */
import { createRequire } from 'node:module'
import mammoth from 'mammoth'
// @ts-ignore — word-extractor has no bundled type declarations
import WordExtractor from 'word-extractor'

// pdfjs-dist uses browser APIs (DOMMatrix, Path2D, ImageData) at module scope.
// In Node.js these don't exist, so we install minimal stubs before importing.
// We only use pdfjs-dist for text extraction — no actual rendering is needed.
function ensurePdfjsPolyfills() {
  if (typeof globalThis.DOMMatrix === 'undefined') {
    // Minimal 6-value identity matrix stub — enough for pdfjs-dist text layer
    globalThis.DOMMatrix = class DOMMatrix {
      a = 1; b = 0; c = 0; d = 1; e = 0; f = 0
    } as any
  }
  if (typeof globalThis.ImageData === 'undefined') {
    globalThis.ImageData = class ImageData {
      data: Uint8ClampedArray; width: number; height: number
      constructor(w: number, h: number) {
        this.width = w; this.height = h
        this.data = new Uint8ClampedArray(w * h * 4)
      }
    } as any
  }
  if (typeof globalThis.Path2D === 'undefined') {
    globalThis.Path2D = class Path2D {} as any
  }
}

const PARSER_VERSION = '1.1' // 1.1: word-hyphen repair (layout params reverted — broke name/order)

export interface ParsedResume {
  /** Full extracted text content */
  text: string
  /** Detected sections (best-effort heuristic) */
  sections: ResumeSection[]
  /** Parsing metadata */
  metadata: {
    pageCount: number | null
    wordCount: number
    characterCount: number
    extractedAt: string
    parserVersion: string
    sourceFormat: 'pdf' | 'docx' | 'doc'
  }
}

export interface ResumeSection {
  heading: string
  content: string
}

/** Max time to wait for the external extractor before falling back. */
const EXTRACTOR_TIMEOUT_MS = 45_000

/**
 * Извлечение текста через внешний Python-сервис (pdfplumber + Tesseract OCR).
 * Возвращает ParsedResume при успехе, иначе null → вызывающий падает на pdf-parse.
 * Управляется env EXTRACTOR_URL; если он не задан — сервис не используется.
 */
async function extractViaService(
  buffer: Buffer,
  mimeType: string,
  filename?: string,
): Promise<ParsedResume | null> {
  const base = process.env.EXTRACTOR_URL
  if (!base) return null
  try {
    const form = new FormData()
    const blob = new Blob([buffer], { type: mimeType })
    form.append('file', blob, filename || (mimeType === 'application/pdf' ? 'resume.pdf' : 'resume.docx'))

    const controller = new AbortController()
    const to = setTimeout(() => controller.abort(), EXTRACTOR_TIMEOUT_MS)
    let resp: Response
    try {
      resp = await fetch(`${base.replace(/\/$/, '')}/extract`, {
        method: 'POST', body: form, signal: controller.signal,
      })
    }
    finally {
      clearTimeout(to)
    }
    if (!resp.ok) {
      logWarn('resume_parser.extractor_http_error', { status: resp.status })
      return null
    }
    const data = await resp.json() as { text?: string, method?: string, pageCount?: number, isScanned?: boolean }
    const text = normalizeText(data.text ?? '')
    if (text.length < 30) return null // пусто — пусть попробует pdf-parse

    return {
      text,
      sections: extractSections(text),
      metadata: {
        pageCount: data.pageCount ?? null,
        wordCount: text.split(/\s+/).filter(Boolean).length,
        characterCount: text.length,
        extractedAt: new Date().toISOString(),
        parserVersion: `extractor:${data.method ?? 'unknown'}`,
        sourceFormat: mimeType === 'application/pdf' ? 'pdf' : 'docx',
      },
    }
  }
  catch (err) {
    logWarn('resume_parser.extractor_unavailable', {
      error_message: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

/** Max time to wait for LibreOffice conversion (cold start can be slow). */
const CONVERT_TIMEOUT_MS = 70_000

/**
 * Конвертация office-документа (DOC/DOCX) в PDF через внешний extractor-сервис
 * (LibreOffice headless). Нужна для единого inline-превью: не-PDF резюме получают
 * производный PDF. Возвращает PDF-байты при успехе, иначе null (превью недоступно →
 * UI предложит скачать оригинал). Управляется env EXTRACTOR_URL.
 */
export async function convertToPdfViaService(
  buffer: Buffer,
  mimeType: string,
  filename?: string,
): Promise<Buffer | null> {
  const base = process.env.EXTRACTOR_URL
  if (!base) return null
  // Уже PDF — конвертировать нечего.
  if (mimeType === 'application/pdf') return buffer
  try {
    const form = new FormData()
    // Uint8Array-view удовлетворяет типу BlobPart (Buffer напрямую — нет под strict TS).
    const blob = new Blob([new Uint8Array(buffer)], { type: mimeType })
    const fallbackName = mimeType === 'application/msword' ? 'resume.doc' : 'resume.docx'
    form.append('file', blob, filename || fallbackName)

    const controller = new AbortController()
    const to = setTimeout(() => controller.abort(), CONVERT_TIMEOUT_MS)
    let resp: Response
    try {
      resp = await fetch(`${base.replace(/\/$/, '')}/convert`, {
        method: 'POST', body: form, signal: controller.signal,
      })
    }
    finally {
      clearTimeout(to)
    }
    if (!resp.ok) {
      logWarn('resume_parser.convert_http_error', { status: resp.status })
      return null
    }
    const arrayBuf = await resp.arrayBuffer()
    const pdf = Buffer.from(arrayBuf)
    // Санити: PDF начинается с «%PDF».
    if (pdf.length < 5 || pdf.subarray(0, 4).toString('latin1') !== '%PDF') {
      logWarn('resume_parser.convert_invalid_output', { size: pdf.length })
      return null
    }
    return pdf
  }
  catch (err) {
    logWarn('resume_parser.convert_unavailable', {
      error_message: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

/**
 * Parse a document buffer and extract text content.
 * Routes to the appropriate parser based on MIME type.
 *
 * @param buffer - Raw file bytes
 * @param mimeType - Validated MIME type of the document
 * @param filename - Original filename (helps the extractor pick a parser)
 * @returns Structured parsed content, or null if extraction fails
 */
export async function parseDocument(
  buffer: Buffer,
  mimeType: string,
  filename?: string,
): Promise<ParsedResume | null> {
  try {
    // Layout-aware extractor (pdfplumber + OCR) — для PDF/DOCX. Он корректно читает
    // многоколоночные/дизайнерские и сканированные резюме, которые pdf-parse портит.
    // Best-effort: при недоступности/ошибке падаем на встроенные парсеры ниже.
    if (mimeType === 'application/pdf'
      || mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      const viaService = await extractViaService(buffer, mimeType, filename)
      if (viaService) return viaService
    }

    switch (mimeType) {
      case 'application/pdf':
        return await parsePdf(buffer)
      case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
        return await parseDocx(buffer)
      case 'application/msword':
        return await parseDoc(buffer)
      default:
        logWarn('resume_parser.unsupported_mime_type', {
          mime_type: mimeType,
        })
        return null
    }
  }
  catch (error) {
    logError('resume_parser.parse_failed', {
      mime_type: mimeType,
      error_message: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

// ─── PDF Parser ───────────────────────────────────────────────────

/**
 * Resolves the path to pdfjs-dist's worker file (`pdf.worker.mjs`) using the
 * project's full `node_modules` tree. Nuxt/Nitro's bundled `.output/server/node_modules/`
 * does not include this worker (dynamic require is untraceable), so without an
 * explicit `workerSrc` pdfjs throws "Setting up fake worker failed" at runtime.
 *
 * Returns `null` if the file can't be resolved (e.g. in a stripped-down image);
 * pdf-parse will then attempt its default fake-worker path.
 */
let pdfWorkerSrcCached: string | null | undefined
function resolvePdfWorkerSrc(): string | null {
  if (pdfWorkerSrcCached !== undefined) return pdfWorkerSrcCached
  try {
    const req = createRequire(import.meta.url)
    pdfWorkerSrcCached = req.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')
  }
  catch {
    pdfWorkerSrcCached = null
  }
  return pdfWorkerSrcCached
}

/** Max time we allow the PDF parser to spend on a single document. */
const PDF_PARSE_TIMEOUT_MS = 30_000

async function parsePdf(buffer: Buffer): Promise<ParsedResume | null> {
  if (buffer.length === 0) return null

  // Polyfill browser globals before pdfjs-dist evaluates its module-level code
  ensurePdfjsPolyfills()
  const { PDFParse } = await import('pdf-parse')

  // Point pdfjs at a real worker file that ships with pdfjs-dist.
  // Without this, Nitro-bundled deployments fail with "Setting up fake worker failed".
  const workerSrc = resolvePdfWorkerSrc()
  if (workerSrc) {
    PDFParse.setWorker(workerSrc)
  }

  const parser = new PDFParse({ data: buffer })

  // Race against a timeout so corrupted PDFs don't hang the worker forever.
  let timeoutHandle: NodeJS.Timeout | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(
      () => reject(new Error(`PDF parse timed out after ${PDF_PARSE_TIMEOUT_MS}ms`)),
      PDF_PARSE_TIMEOUT_MS,
    )
  })

  let result
  try {
    // Извлечение текста дефолтными параметрами pdf-parse (естественный порядок чтения).
    // Прим.: layout-параметры (cellSeparator/cellThreshold) НЕ используем — они
    // переупорядочивали дизайнерские резюме и ломали определение ФИО. Улучшение
    // многоколоночных макетов делаем отдельно и осознанно (см. диагностику).
    result = await Promise.race([parser.getText(), timeoutPromise])
  }
  finally {
    if (timeoutHandle) clearTimeout(timeoutHandle)
  }

  const text = normalizeText(result.text)
  if (!text) {
    await parser.destroy()
    return null
  }

  const parsed: ParsedResume = {
    text,
    sections: extractSections(text),
    metadata: {
      pageCount: result.total,
      wordCount: countWords(text),
      characterCount: text.length,
      extractedAt: new Date().toISOString(),
      parserVersion: PARSER_VERSION,
      sourceFormat: 'pdf',
    },
  }

  await parser.destroy()
  return parsed
}

// ─── DOCX Parser ──────────────────────────────────────────────────

async function parseDocx(buffer: Buffer): Promise<ParsedResume | null> {
  const result = await mammoth.extractRawText({ buffer })

  const text = normalizeText(result.value)
  if (!text) return null

  return {
    text,
    sections: extractSections(text),
    metadata: {
      pageCount: null, // DOCX doesn't have pages
      wordCount: countWords(text),
      characterCount: text.length,
      extractedAt: new Date().toISOString(),
      parserVersion: PARSER_VERSION,
      sourceFormat: 'docx',
    },
  }
}

// ─── DOC Parser (Legacy) ──────────────────────────────────────────

async function parseDoc(buffer: Buffer): Promise<ParsedResume | null> {
  const extractor = new WordExtractor()
  const doc = await extractor.extract(buffer)

  // Combine main body, headers, and footers
  const parts = [
    doc.getBody(),
    doc.getHeaders({ includeFooters: false }),
    doc.getFooters(),
  ].filter(Boolean)

  const rawText = parts.join('\n')
  const text = normalizeText(rawText)
  if (!text) return null

  return {
    text,
    sections: extractSections(text),
    metadata: {
      pageCount: null,
      wordCount: countWords(text),
      characterCount: text.length,
      extractedAt: new Date().toISOString(),
      parserVersion: PARSER_VERSION,
      sourceFormat: 'doc',
    },
  }
}

// ─── Text Normalization ───────────────────────────────────────────

/**
 * Clean up extracted text: collapse whitespace, trim, remove control chars.
 * Returns empty string if no meaningful content was extracted.
 */
function normalizeText(raw: string): string {
  return raw
    // Remove null bytes and control characters (except newline/tab)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    // Normalize Windows line endings
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    // Починка переносов слов по слогам из PDF: «раз-\nработка» → «разработка».
    // (дефис в конце строки + перенос + строчная буква = разорванное слово)
    .replace(/([а-яёa-z])-\n([а-яёa-z])/gi, '$1$2')
    // Collapse 3+ consecutive newlines into 2
    .replace(/\n{3,}/g, '\n\n')
    // Collapse multiple spaces/tabs on same line into one
    .replace(/[^\S\n]+/g, ' ')
    // Trim each line
    .split('\n')
    .map(line => line.trim())
    .join('\n')
    // Final trim
    .trim()
}

// ─── Section Extraction ───────────────────────────────────────────

/**
 * Best-effort extraction of resume sections based on common heading patterns.
 * This is a heuristic approach — not all resumes follow standard formats.
 */
const SECTION_HEADINGS = [
  // Experience / Work
  /^(?:work\s*)?experience/i,
  /^employment\s*(?:history)?/i,
  /^professional\s*(?:experience|background|history)/i,
  /^career\s*(?:history|summary)/i,
  /^work\s*history/i,

  // Education
  /^education(?:al\s*background)?/i,
  /^academic\s*(?:background|qualifications)/i,
  /^qualifications/i,

  // Skills
  /^(?:technical\s*)?skills/i,
  /^core\s*competencies/i,
  /^technologies/i,
  /^tools?\s*(?:&|and)\s*technologies/i,
  /^expertise/i,

  // Summary / Profile / Objective
  /^(?:professional\s*)?summary/i,
  /^(?:career\s*)?objective/i,
  /^profile/i,
  /^about\s*(?:me)?/i,

  // Certifications / Awards
  /^certifications?/i,
  /^licenses?\s*(?:&|and)\s*certifications?/i,
  /^awards?\s*(?:&|and)\s*(?:honors?|achievements?)/i,
  /^achievements?/i,
  /^honors?/i,

  // Projects / Publications
  /^(?:key\s*)?projects?/i,
  /^publications?/i,
  /^research/i,
  /^portfolio/i,

  // Languages / Interests
  /^languages?/i,
  /^interests?\s*(?:&|and)\s*(?:hobbies|activities)/i,
  /^hobbies/i,
  /^volunteer(?:ing)?\s*(?:experience)?/i,

  // References
  /^references?/i,

  // Contact
  /^contact\s*(?:information|details)?/i,
  /^personal\s*(?:information|details)/i,

  // ─── Русские заголовки (RU) ───
  // Текущая эвристика знала только английские заголовки — русские резюме не
  // делились на блоки вовсе. Паттерны толерантны к регистру (флаг i) и к
  // двоеточию/тексту после заголовка (isHeading режет по длине < 60).

  // Опыт работы
  /^опыт\s*работы/i,
  /^опыт(?:\s|$|:)/i,
  /^профессиональный\s*опыт/i,
  /^мест[оа]\s*работы/i,
  /^карьера/i,
  /^трудовая\s*деятельность/i,

  // Образование
  /^образовани[ея]/i,
  /^учебн(?:ое|ые)\s*заведени[ея]/i,
  /^обучение/i,
  /^квалификация/i,

  // Навыки
  /^(?:ключевые|профессиональные|технические)?\s*навыки/i,
  /^компетенции/i,
  /^технологии/i,
  /^стек\s*технологий/i,

  // О себе / Профиль
  /^о\s*себе/i,
  /^обо\s*мне/i,
  /^профиль/i,
  /^краткая\s*информация/i,

  // Достижения / Сертификаты / Курсы
  /^достижени[яй]/i,
  /^сертификаты/i,
  /^курсы(?:\s*(?:и|&)\s*сертификаты)?/i,
  /^награды/i,

  // Проекты / Публикации
  /^проекты/i,
  /^публикации/i,
  /^портфолио/i,

  // Языки
  /^язык(?:и|ознание)?/i,
  /^владение\s*языками/i,
  /^знание\s*языков/i,

  // Контакты / Личная информация
  /^контакт(?:ы|ная\s*информация)?/i,
  /^личн(?:ая|ые)\s*(?:информация|данные)/i,

  // Рекомендации
  /^рекомендации/i,
]

export function extractSections(text: string): ResumeSection[] {
  const lines = text.split('\n')
  const sections: ResumeSection[] = []
  let currentHeading: string | null = null
  let currentContent: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) {
      currentContent.push('')
      continue
    }

    // Check if this line matches a known section heading pattern
    // Headings are typically short (< 60 chars) and on their own line
    const isHeading = trimmed.length < 60 && SECTION_HEADINGS.some(pattern => pattern.test(trimmed))

    if (isHeading) {
      // Save previous section
      if (currentHeading !== null) {
        const content = currentContent.join('\n').trim()
        if (content) {
          sections.push({ heading: currentHeading, content })
        }
      }
      currentHeading = trimmed
      currentContent = []
    }
    else {
      currentContent.push(trimmed)
    }
  }

  // Save last section
  if (currentHeading !== null) {
    const content = currentContent.join('\n').trim()
    if (content) {
      sections.push({ heading: currentHeading, content })
    }
  }

  return sections
}

// ─── Helpers ──────────────────────────────────────────────────────

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

// ─── Resume Text Extraction ──────────────────────────────────────

/**
 * Extract plain text from a parsedContent JSONB value.
 * Handles both the structured ParsedResume format and legacy string values.
 * Used by the scoring/analysis endpoints.
 *
 * @param parsedContent - The raw JSONB value from document.parsedContent
 * @returns The extracted text, or null if no content is available
 */
export function extractResumeText(parsedContent: unknown): string | null {
  if (!parsedContent) return null

  // Structured ParsedResume format: { text: "...", sections: [...], metadata: {...} }
  if (typeof parsedContent === 'object' && parsedContent !== null && 'text' in parsedContent) {
    const text = (parsedContent as { text: unknown }).text
    if (typeof text === 'string' && text.trim()) return text
    // If it has a text property but it's empty, there's no useful content
    return null
  }

  // Legacy: plain string value
  if (typeof parsedContent === 'string' && parsedContent.trim()) {
    return parsedContent
  }

  // Fallback: stringify object (should rarely happen)
  if (typeof parsedContent === 'object') {
    const str = JSON.stringify(parsedContent)
    return str && str !== '{}' && str !== '[]' ? str : null
  }

  return null
}
