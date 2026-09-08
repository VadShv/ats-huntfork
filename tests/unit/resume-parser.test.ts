import { describe, it, expect } from 'vitest'
import { parseDocument, extractResumeText, extractSections, type ParsedResume } from '../../server/utils/resume-parser'

/**
 * Create a minimal valid PDF containing the given text.
 * Uses a simple Type1/Helvetica font and a single page.
 */
function createTestPdf(text: string): Buffer {
  const streamContent = `BT /F1 12 Tf 72 700 Td (${text}) Tj ET`

  const content = [
    '%PDF-1.4',
    '1 0 obj',
    '<< /Type /Catalog /Pages 2 0 R >>',
    'endobj',
    '2 0 obj',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    'endobj',
    '3 0 obj',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    'endobj',
    `4 0 obj`,
    `<< /Length ${streamContent.length} >>`,
    'stream',
    streamContent,
    'endstream',
    'endobj',
    '5 0 obj',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    'endobj',
    'xref',
    '0 6',
    '0000000000 65535 f ',
    '0000000009 00000 n ',
    '0000000058 00000 n ',
    '0000000115 00000 n ',
    '0000000266 00000 n ',
    '0000000360 00000 n ',
    'trailer',
    '<< /Size 6 /Root 1 0 R >>',
    'startxref',
    '441',
    '%%EOF',
  ].join('\n')

  return Buffer.from(content)
}

// ─── Tests ───────────────────────────────────────────────────────

describe('resume-parser', () => {
  describe('parseDocument', () => {
    it('returns null for unsupported MIME types', async () => {
      const buffer = Buffer.from('test content')
      const result = await parseDocument(buffer, 'text/plain')
      expect(result).toBeNull()
    })

    it('returns null for empty buffer', async () => {
      const buffer = Buffer.alloc(0)
      const result = await parseDocument(buffer, 'application/pdf')
      expect(result).toBeNull()
    })

    it('returns null for corrupted data without crashing', async () => {
      const buffer = Buffer.from('not a real pdf file content')
      const result = await parseDocument(buffer, 'application/pdf')
      expect(result).toBeNull()
    })

    it('parses a valid PDF and returns structured content', async () => {
      const pdf = createTestPdf('John Doe Software Engineer')
      const result = await parseDocument(pdf, 'application/pdf')

      expect(result).not.toBeNull()
      expect(result!.text).toContain('John Doe')
      expect(result!.metadata.sourceFormat).toBe('pdf')
      // Проверяем формат версии, а не конкретное значение — иначе тест ломается
      // при каждом бампе PARSER_VERSION (был захардкожен '1.0', код ушёл на '1.1').
      expect(result!.metadata.parserVersion).toMatch(/^\d+\.\d+$/)
      expect(result!.metadata.wordCount).toBeGreaterThan(0)
      expect(result!.metadata.extractedAt).toBeTruthy()
      expect(result!.metadata.pageCount).toBe(1)
    })

    it('handles DOCX mime type gracefully with invalid data', async () => {
      const buffer = Buffer.from('not a real docx')
      const result = await parseDocument(buffer, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      expect(result).toBeNull()
    })

    it('handles DOC mime type gracefully with invalid data', async () => {
      const buffer = Buffer.from('not a real doc')
      const result = await parseDocument(buffer, 'application/msword')
      expect(result).toBeNull()
    })
  })

  describe('extractResumeText', () => {
    it('returns null for null input', () => {
      expect(extractResumeText(null)).toBeNull()
    })

    it('returns null for undefined input', () => {
      expect(extractResumeText(undefined)).toBeNull()
    })

    it('returns null for empty string', () => {
      expect(extractResumeText('')).toBeNull()
    })

    it('returns null for whitespace-only string', () => {
      expect(extractResumeText('   ')).toBeNull()
    })

    it('extracts text from structured ParsedResume format', () => {
      const parsed: ParsedResume = {
        text: 'John Doe\nSoftware Engineer\n\nExperience\n5 years at Google',
        sections: [{ heading: 'Experience', content: '5 years at Google' }],
        metadata: {
          pageCount: 1,
          wordCount: 10,
          characterCount: 50,
          extractedAt: '2024-01-01T00:00:00Z',
          parserVersion: '1.0',
          sourceFormat: 'pdf',
        },
      }

      const result = extractResumeText(parsed)
      expect(result).toBe('John Doe\nSoftware Engineer\n\nExperience\n5 years at Google')
    })

    it('handles legacy plain string values', () => {
      const result = extractResumeText('This is a resume text')
      expect(result).toBe('This is a resume text')
    })

    it('returns null for unknown object shapes (no text leaked into scoring)', () => {
      // An object without a `text` field is not resume content. Previously this
      // was JSON.stringify'd and leaked raw JSON into the AI scoring prompt.
      const result = extractResumeText({ foo: 'bar' })
      expect(result).toBeNull()
    })

    it('returns null for empty objects', () => {
      expect(extractResumeText({})).toBeNull()
    })

    it('returns null for empty arrays', () => {
      expect(extractResumeText([])).toBeNull()
    })

    it('handles structured format with empty text', () => {
      const parsed = { text: '', sections: [], metadata: {} }
      const result = extractResumeText(parsed)
      // Empty text should return null (falls through to stringify)
      expect(result).toBeNull()
    })
  })

  describe('extractSections', () => {
    it('splits an English resume into sections by known headings', () => {
      const text = [
        'John Doe',
        'Software Engineer',
        '',
        'Experience',
        'Senior Developer at Google (2020-2024)',
        '',
        'Education',
        'BSc Computer Science, MIT',
        '',
        'Skills',
        'TypeScript, Vue, Node.js',
      ].join('\n')

      const sections = extractSections(text)
      const headings = sections.map(s => s.heading)
      expect(headings).toContain('Experience')
      expect(headings).toContain('Education')
      expect(headings).toContain('Skills')

      const exp = sections.find(s => s.heading === 'Experience')
      expect(exp?.content).toContain('Google')
    })

    it('splits a RUSSIAN resume into sections (RU headings)', () => {
      const text = [
        'Иван Иванов',
        'Backend-разработчик',
        '',
        'Опыт работы',
        'Ведущий разработчик в Яндексе (2020–2024)',
        '',
        'Образование',
        'МГУ, факультет ВМК',
        '',
        'Ключевые навыки',
        'Go, PostgreSQL, Docker',
        '',
        'О себе',
        'Более 8 лет в бэкенде.',
      ].join('\n')

      const sections = extractSections(text)
      const headings = sections.map(s => s.heading)
      expect(headings).toContain('Опыт работы')
      expect(headings).toContain('Образование')
      expect(headings).toContain('Ключевые навыки')
      expect(headings).toContain('О себе')

      const exp = sections.find(s => s.heading === 'Опыт работы')
      expect(exp?.content).toContain('Яндексе')
      const about = sections.find(s => s.heading === 'О себе')
      expect(about?.content).toContain('8 лет')
    })

    it('matches RU headings case-insensitively and with a trailing colon', () => {
      const text = [
        'Опыт:',
        'Компания А',
        '',
        'НАВЫКИ',
        'Python, SQL',
      ].join('\n')

      const sections = extractSections(text)
      const headings = sections.map(s => s.heading)
      expect(headings).toContain('Опыт:')
      expect(headings).toContain('НАВЫКИ')
    })

    it('returns no sections when there are no recognizable headings', () => {
      const text = 'Просто сплошной текст без заголовков разделов, одна строка.'
      const sections = extractSections(text)
      expect(sections).toEqual([])
    })
  })
})
