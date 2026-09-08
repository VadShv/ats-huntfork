import { describe, it, expect } from 'vitest'
import {
  detectDocumentMime,
  isAllowedDocumentMime,
  ALLOWED_MIME_TYPES,
} from '../../server/utils/schemas/document'
import {
  MINIMAL_PDF,
  MINIMAL_DOC,
  MINIMAL_DOCX,
  INVALID_PNG,
  INVALID_PLAINTEXT,
} from '../../e2e/fixtures/test-buffers'

/**
 * Regression tests for the shared upload MIME detector.
 *
 * The key bug this guards against: `file-type` v21 detects legacy OLE2 `.doc`
 * files as `application/x-cfb` (older versions returned `undefined`). The
 * per-endpoint code only checked the `!mimeType` case, so `.doc` uploads were
 * rejected everywhere except the public apply endpoint. `detectDocumentMime`
 * now centralises the OLE2 remap so every endpoint behaves the same.
 */
describe('detectDocumentMime', () => {
  it('detects a PDF from its %PDF magic bytes', async () => {
    expect(await detectDocumentMime(MINIMAL_PDF)).toBe('application/pdf')
  })

  it('detects a modern DOCX (OOXML/ZIP) as wordprocessingml', async () => {
    expect(await detectDocumentMime(MINIMAL_DOCX)).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    )
  })

  it('remaps a legacy OLE2 .doc to application/msword (the x-cfb bug)', async () => {
    // This is the case that regressed: newer file-type returns x-cfb (or
    // undefined), and only the OLE2 magic-byte check rescues it.
    expect(await detectDocumentMime(MINIMAL_DOC)).toBe('application/msword')
  })

  it('returns a non-allowed type for a PNG (so callers reject it)', async () => {
    const mime = await detectDocumentMime(INVALID_PNG)
    expect(mime).toBe('image/png')
    expect(isAllowedDocumentMime(mime)).toBe(false)
  })

  it('returns undefined for a plain-text file with no magic bytes', async () => {
    const mime = await detectDocumentMime(INVALID_PLAINTEXT)
    expect(mime).toBeUndefined()
    expect(isAllowedDocumentMime(mime)).toBe(false)
  })

  it('does not misfire the OLE2 remap on a too-short buffer', async () => {
    // Fewer than 8 bytes must never be remapped to msword.
    const tiny = Buffer.from([0xD0, 0xCF, 0x11])
    expect(await detectDocumentMime(tiny)).toBeUndefined()
  })
})

describe('isAllowedDocumentMime', () => {
  it('accepts every allowed document MIME type', () => {
    for (const mime of ALLOWED_MIME_TYPES) {
      expect(isAllowedDocumentMime(mime)).toBe(true)
    }
  })

  it('rejects undefined and unrelated types', () => {
    expect(isAllowedDocumentMime(undefined)).toBe(false)
    expect(isAllowedDocumentMime('image/png')).toBe(false)
    expect(isAllowedDocumentMime('application/x-cfb')).toBe(false)
    expect(isAllowedDocumentMime('text/plain')).toBe(false)
  })
})
