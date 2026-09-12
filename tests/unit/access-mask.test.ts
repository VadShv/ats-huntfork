import { describe, it, expect } from 'vitest'
import { maskCandidate, maskCandidates, canReadContacts, canReadSalary } from '../../server/utils/access/mask'
import type { ActorContext } from '../../server/utils/access/actorContext'

/**
 * RBAC v2 Sprint 3 — field masking (masking-on-output by default).
 * Pure functions; build actors with explicit capability sets.
 */

function actor(caps: string[]): ActorContext {
  return {
    userId: 'u1', memberId: 'm1', orgId: 'o1',
    roleKeys: ['member'],
    permissions: new Set(caps),
    overrides: new Map(),
    scope: { type: 'assigned', departmentIds: [], jobIds: [] },
    limits: null, status: 'active', isViewAs: false,
    canViewSalary: false, mustChangePassword: false,
  }
}

const CANDIDATE = {
  id: 'c1', firstName: 'Иван', lastName: 'П.',
  email: 'ivan@example.com', phone: '+79990000000',
  telegram: '@ivan', linkedin: 'in/ivan', github: 'gh/ivan',
  hhResumeRaw: { salary: { amount: 100000, currency: 'RUR' }, title: 'Dev' },
}

describe('maskCandidate — contacts', () => {
  it('nulls contacts without candidate:read:contacts and reports _masked', () => {
    const out = maskCandidate(actor([]), CANDIDATE)
    expect(out.email).toBeNull()
    expect(out.phone).toBeNull()
    expect(out.telegram).toBeNull()
    expect(out.linkedin).toBeNull()
    expect(out.github).toBeNull()
    expect(out._masked).toEqual(expect.arrayContaining(['email', 'phone', 'telegram', 'linkedin', 'github']))
  })

  it('keeps contacts with candidate:read:contacts', () => {
    const out = maskCandidate(actor(['candidate:read:contacts']), CANDIDATE)
    expect(out.email).toBe('ivan@example.com')
    expect(out.phone).toBe('+79990000000')
    expect(out._masked).not.toContain('email')
  })
})

describe('maskCandidate — salary', () => {
  it('nulls salary inside hhResumeRaw without candidate:read:salary', () => {
    const out = maskCandidate(actor(['candidate:read:contacts']), CANDIDATE)
    expect((out.hhResumeRaw as { salary: unknown }).salary).toBeNull()
    expect((out.hhResumeRaw as { title: string }).title).toBe('Dev') // rest kept
    expect(out._masked).toContain('hhResumeRaw.salary')
  })

  it('nulls derived expectedSalary without candidate:read:salary', () => {
    const out = maskCandidate(actor([]), { id: 'c', expectedSalary: { amount: 5, currency: 'RUR' } })
    expect(out.expectedSalary).toBeNull()
    expect(out._masked).toContain('expectedSalary')
  })

  it('keeps salary with candidate:read:salary', () => {
    const out = maskCandidate(actor(['candidate:read:salary']), CANDIDATE)
    expect((out.hhResumeRaw as { salary: unknown }).salary).toEqual({ amount: 100000, currency: 'RUR' })
    expect(out._masked).not.toContain('hhResumeRaw.salary')
  })
})

describe('maskCandidate — safety', () => {
  it('null actor masks everything (deny-by-default)', () => {
    const out = maskCandidate(null, CANDIDATE)
    expect(out.email).toBeNull()
    expect((out.hhResumeRaw as { salary: unknown }).salary).toBeNull()
  })

  it('does not mutate the input object', () => {
    const input = { ...CANDIDATE, hhResumeRaw: { ...CANDIDATE.hhResumeRaw } }
    maskCandidate(actor([]), input)
    expect(input.email).toBe('ivan@example.com')
    expect(input.hhResumeRaw.salary).not.toBeNull()
  })

  it('always sets _masked (empty when fully authorized)', () => {
    const out = maskCandidate(actor(['candidate:read:contacts', 'candidate:read:salary']), CANDIDATE)
    expect(out._masked).toEqual([])
  })
})

describe('maskCandidates + helpers', () => {
  it('masks a list', () => {
    const out = maskCandidates(actor([]), [CANDIDATE, { id: 'c2', email: 'a@b.c' }])
    expect(out[0].email).toBeNull()
    expect(out[1].email).toBeNull()
  })

  it('canReadContacts / canReadSalary reflect permissions', () => {
    expect(canReadContacts(actor(['candidate:read:contacts']))).toBe(true)
    expect(canReadContacts(actor([]))).toBe(false)
    expect(canReadSalary(actor(['candidate:read:salary']))).toBe(true)
    expect(canReadSalary(null)).toBe(false)
  })
})
