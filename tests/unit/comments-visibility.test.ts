import { describe, it, expect } from 'vitest'
import { canSeeInternal } from '../../server/utils/comments/visibility'

describe('canSeeInternal', () => {
  it('returns true for owner, admin, recruiter', () => {
    expect(canSeeInternal('owner')).toBe(true)
    expect(canSeeInternal('admin')).toBe(true)
    expect(canSeeInternal('recruiter')).toBe(true)
  })

  it('returns false for hiring_manager and member', () => {
    expect(canSeeInternal('hiring_manager')).toBe(false)
    expect(canSeeInternal('member')).toBe(false)
  })

  it('returns false for unknown or empty role', () => {
    expect(canSeeInternal('')).toBe(false)
    expect(canSeeInternal(null)).toBe(false)
    expect(canSeeInternal(undefined)).toBe(false)
    expect(canSeeInternal('unknown_role')).toBe(false)
  })
})
