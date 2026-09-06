import { describe, it, expect } from 'vitest'
import { upsertBriefSchema } from '../../server/utils/schemas/jobBrief'
import {
  createInterviewQuestionSchema,
  updateInterviewQuestionSchema,
  generateInterviewQuestionsSchema,
} from '../../server/utils/schemas/interviewQuestion'

/**
 * Validates the Stage 1 (brief) and Stage 2 (interview questions) input schemas.
 * These guard the API endpoints; the tests pin down defaults, coercion and limits.
 */
describe('upsertBriefSchema', () => {
  it('accepts an empty object (all fields optional)', () => {
    const r = upsertBriefSchema.safeParse({})
    expect(r.success).toBe(true)
  })

  it('accepts chip lists and free text', () => {
    const r = upsertBriefSchema.safeParse({
      hardMustHave: ['PostgreSQL', 'Node.js'],
      dealBreakers: ['no remote'],
      responsibilities: 'Build the API',
      freeform: 'Some notes',
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.hardMustHave).toEqual(['PostgreSQL', 'Node.js'])
  })

  it('allows null to clear a text field', () => {
    const r = upsertBriefSchema.safeParse({ responsibilities: null })
    expect(r.success).toBe(true)
  })

  it('rejects a chip that is too long', () => {
    const r = upsertBriefSchema.safeParse({ hardMustHave: ['x'.repeat(301)] })
    expect(r.success).toBe(false)
  })

  it('rejects more than 50 chips', () => {
    const r = upsertBriefSchema.safeParse({ niceToHave: Array.from({ length: 51 }, (_, i) => `c${i}`) })
    expect(r.success).toBe(false)
  })
})

describe('createInterviewQuestionSchema', () => {
  it('defaults category to other and requires text', () => {
    const r = createInterviewQuestionSchema.safeParse({ text: 'Tell me about X' })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.category).toBe('other')
      expect(r.data.displayOrder).toBe(0)
    }
  })

  it('rejects empty text', () => {
    const r = createInterviewQuestionSchema.safeParse({ text: '   ' })
    expect(r.success).toBe(false)
  })

  it('rejects an unknown category', () => {
    const r = createInterviewQuestionSchema.safeParse({ text: 'Q', category: 'nope' })
    expect(r.success).toBe(false)
  })
})

describe('updateInterviewQuestionSchema', () => {
  it('accepts a partial archive toggle', () => {
    const r = updateInterviewQuestionSchema.safeParse({ isArchived: true })
    expect(r.success).toBe(true)
  })
})

describe('generateInterviewQuestionsSchema', () => {
  it('applies defaults for prompt and count', () => {
    const r = generateInterviewQuestionsSchema.safeParse({})
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.count).toBe(10)
      expect(r.data.promptText).toBe('')
    }
  })

  it('clamps are enforced via max (count > 30 rejected)', () => {
    const r = generateInterviewQuestionsSchema.safeParse({ count: 31 })
    expect(r.success).toBe(false)
  })
})
