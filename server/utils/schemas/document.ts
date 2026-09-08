import { z } from 'zod'
import { fileTypeFromBuffer } from 'file-type'

// ─────────────────────────────────────────────
// Document validation schemas & constants
// ─────────────────────────────────────────────

/**
 * MIME types allowed for document upload.
 * Restricts uploads to PDF and Word documents only.
 */
export const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const

/** Maximum file size in bytes (10 MB) */
export const MAX_FILE_SIZE = 10 * 1024 * 1024

/** Maximum number of documents per candidate */
export const MAX_DOCUMENTS_PER_CANDIDATE = 20

/**
 * Map of allowed MIME types to their file extensions.
 * Used to derive a safe file extension from the validated MIME type.
 */
export const MIME_TO_EXTENSION: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
}

/** Schema for the document type field (matches the DB enum) */
export const documentTypeSchema = z.enum(['resume', 'cover_letter', 'other'])

/**
 * OLE2 Compound Binary File magic signature (legacy .doc, .xls, .ppt).
 * `file-type` does not map this to `application/msword` — older versions
 * return `undefined`, newer versions (v21+) return `application/x-cfb`.
 * We remap it to `application/msword` ourselves for legacy Word documents.
 */
const OLE2_MAGIC = Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1])

/**
 * Detect a document's MIME type from its magic bytes, with a fallback for
 * legacy OLE2 `.doc` files.
 *
 * Why this exists: `readMultipartFormData` gives us the browser-declared
 * `Content-Type`, which is trivially spoofable. We validate the *real* type
 * from the file's magic bytes via `file-type`. The one gap is legacy `.doc`
 * (OLE2 compound documents): `file-type` returns `undefined` (older) or
 * `application/x-cfb` (v21+) rather than `application/msword`. Both cases are
 * remapped here by checking the 8-byte OLE2 signature.
 *
 * IMPORTANT: this is the single source of truth for upload MIME detection.
 * All upload endpoints MUST use it so the OLE2 remap never drifts out of sync
 * (a past bug: the `x-cfb` case was fixed only in the public apply endpoint,
 * so `.doc` uploads were rejected everywhere else).
 *
 * @returns the detected/remapped MIME type, or `undefined` if unknown.
 */
export async function detectDocumentMime(buffer: Buffer): Promise<string | undefined> {
  const detected = await fileTypeFromBuffer(buffer)
  let mime = detected?.mime

  // Legacy .doc (OLE2): file-type can't map it — check the magic bytes ourselves.
  if (!mime || mime === 'application/x-cfb') {
    if (buffer.length >= 8 && Buffer.compare(buffer.subarray(0, 8), OLE2_MAGIC) === 0) {
      mime = 'application/msword'
    }
  }

  return mime
}

/** True when the detected MIME type is an accepted document upload type. */
export function isAllowedDocumentMime(mime: string | undefined): mime is typeof ALLOWED_MIME_TYPES[number] {
  return !!mime && (ALLOWED_MIME_TYPES as readonly string[]).includes(mime)
}

/**
 * Sanitize a user-provided filename for safe storage and display.
 * Removes characters that could enable path traversal, XSS, or
 * filesystem-level exploits. Never use raw user-supplied filenames.
 */
export function sanitizeFilename(filename: string): string {
  return filename
    .replace(/[<>:"'\/\\|?*\x00-\x1f]/g, '_') // Replace dangerous chars
    .replace(/\.{2,}/g, '.') // Collapse consecutive dots (path traversal)
    .replace(/^[.\s]+|[.\s]+$/g, '') // Remove leading/trailing dots and spaces
    .slice(0, 255) // Limit length
    || 'unnamed'
}
