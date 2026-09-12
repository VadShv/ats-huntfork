import { describe, it, expect } from 'vitest'
import { effectiveJobIds, assertJobAllowed, type ChatbotToolContext } from '../../server/utils/ai/chatTools'

/**
 * RBAC v2 Sprint 3 rollout — AI assistant member-scope intersection.
 * The assistant INHERITS the recruiter's scope; the model cannot widen it.
 * Tests the pure conversation-scope ∩ member-scope logic (prompt-injection defense).
 */

function ctx(over: Partial<ChatbotToolContext>): ChatbotToolContext {
  return {
    orgId: 'o1',
    scope: { kind: 'org' } as ChatbotToolContext['scope'],
    attachments: [],
    memberJobIds: null,
    ...over,
  }
}

describe('effectiveJobIds — conversation ∩ member', () => {
  it('both unrestricted → null (org-wide)', () => {
    expect(effectiveJobIds(ctx({ memberJobIds: null }))).toBeNull()
  })

  it('member-restricted, no conversation pin → member set', () => {
    expect(effectiveJobIds(ctx({ memberJobIds: ['j1', 'j2'] }))).toEqual(['j1', 'j2'])
  })

  it('conversation pins a job the member CAN see → [job]', () => {
    const c = ctx({ scope: { kind: 'job', jobId: 'j1' } as never, memberJobIds: ['j1', 'j2'] })
    expect(effectiveJobIds(c)).toEqual(['j1'])
  })

  it('conversation pins a job the member CANNOT see → [] (member wins)', () => {
    const c = ctx({ scope: { kind: 'job', jobId: 'jX' } as never, memberJobIds: ['j1', 'j2'] })
    expect(effectiveJobIds(c)).toEqual([])
  })

  it('member unrestricted, conversation pins a job → [job]', () => {
    const c = ctx({ scope: { kind: 'job', jobId: 'j9' } as never, memberJobIds: null })
    expect(effectiveJobIds(c)).toEqual(['j9'])
  })

  it('member sees nothing → [] regardless of conversation', () => {
    expect(effectiveJobIds(ctx({ memberJobIds: [] }))).toEqual([])
  })
})

describe('assertJobAllowed — server-side guard (ignores model intent)', () => {
  it('allows a job in the member set', () => {
    expect(() => assertJobAllowed(ctx({ memberJobIds: ['j1'] }), 'j1')).not.toThrow()
  })

  it('throws for a job outside the member set', () => {
    expect(() => assertJobAllowed(ctx({ memberJobIds: ['j1'] }), 'j2')).toThrow(/outside your access scope/)
  })

  it('allows any job when unrestricted', () => {
    expect(() => assertJobAllowed(ctx({ memberJobIds: null }), 'anything')).not.toThrow()
  })

  it('respects conversation scope too (pinned job mismatch throws)', () => {
    const c = ctx({ scope: { kind: 'job', jobId: 'j1' } as never, memberJobIds: null })
    expect(() => assertJobAllowed(c, 'j2')).toThrow()
  })
})
