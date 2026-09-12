import { describe, it, expect } from 'vitest'
import { canSeeInternal } from '../../server/utils/comments/visibility'

describe('canSeeInternal', () => {
  it('returns true for owner, admin, member(=recruiter), recruiter, lead_recruiter', () => {
    expect(canSeeInternal('owner')).toBe(true)
    expect(canSeeInternal('admin')).toBe(true)
    // BUGFIX (Sprint 3): the recruiter's org-role is 'member' — it MUST see
    // internal comments. Previously this returned false due to a phantom
    // 'recruiter' org-role in the allow-set (audit-rbac.md §5).
    expect(canSeeInternal('member')).toBe(true)
    expect(canSeeInternal('recruiter')).toBe(true)
    expect(canSeeInternal('lead_recruiter')).toBe(true)
  })

  it('returns false for hiring_manager and junior_recruiter', () => {
    expect(canSeeInternal('hiring_manager')).toBe(false)
    expect(canSeeInternal('junior_recruiter')).toBe(false)
  })

  it('returns false for unknown or empty role', () => {
    expect(canSeeInternal('')).toBe(false)
    expect(canSeeInternal(null)).toBe(false)
    expect(canSeeInternal(undefined)).toBe(false)
    expect(canSeeInternal('unknown_role')).toBe(false)
  })
})
