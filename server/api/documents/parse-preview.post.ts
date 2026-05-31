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
    throw createError({ statusCode: 400, statusMessage: 'No form data received' })
  }

  const filePart = formData.find((part) => part.name === 'file')
  if (!filePart || !filePart.data || !filePart.filename) {
    throw createError({ statusCode: 400, statusMessage: 'No file provided' })
  }

  // ─────────────────────────────────────────────
  // 3. Validate file size
  // ─────────────────────────────────────────────
  const fileBuffer = filePart.data
  if (fileBuffer.length > MAX_FILE_SIZE) {
    throw createError({
      statusCode: 413,
      statusMessage: `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024} MB`,
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
      statusMessage: 'Unsupported file type. Only PDF, DOC, and DOCX files are allowed.',
    })
  }

  // ─────────────────────────────────────────────
  // 5. Parse document (best-effort — no file saved)
  // ─────────────────────────────────────────────
  const parsed = await parseDocument(fileBuffer, mimeType)

  if (!parsed || !parsed.text) {
    throw createError({
      statusCode: 422,
      statusMessage: 'Could not extract text from the document',
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

  // Full name — first non-empty line of the resume that looks like 2–3 capitalised words
  // Try the very first lines before any noise (email, phone, header artifacts)
  let firstName: string | undefined
  let lastName: string | undefined
  let displayName: string | undefined

  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  for (const line of lines.slice(0, 10)) {
    // Skip lines that contain an email, URL, digit-heavy strings, or are too long
    if (email && line.includes(email)) continue
    if (/https?:\/\/|www\.|@/.test(line)) continue
    if (/\d{2,}/.test(line)) continue // phone/date lines
    if (line.length > 60) continue

    // 2–3 words, each starting with a capital or cyrillic uppercase letter
    const words = line.split(/\s+/)
    if (words.length < 2 || words.length > 3) continue

    // Each word must start with an uppercase letter (Latin or Cyrillic)
    const allCapitalised = words.every((w) => /^[A-ZА-ЯЁ]/.test(w))
    if (!allCapitalised) continue

    // Looks like a name — take it
    if (words.length === 2) {
      // Could be "Firstname Lastname" or "Lastname Firstname" — assume Western order
      firstName = words[0]
      lastName = words[1]
    } else {
      // 3 words — likely "Lastname Firstname Patronymic" (Russian style)
      // Store full as displayName, and split as last/first
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
    email,
    phone,
    textPreview: text.slice(0, 500),
    wordCount: metadata.wordCount,
    sourceFormat: metadata.sourceFormat,
  }
})
