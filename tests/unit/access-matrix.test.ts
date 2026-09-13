import { describe, it, expect } from 'vitest'
import { buildMatrixRows, keysForLevel, levelFromGrants, isExactLevel, MATRIX_LEVELS } from '../../shared/access/matrix'

/**
 * RBAC v2 Sprint 7 — role matrix level ↔ permission mapping (pure).
 */

const rows = buildMatrixRows()
const candidate = rows.find((r) => r.resource === 'candidate')!
const job = rows.find((r) => r.resource === 'job')!

describe('buildMatrixRows', () => {
  it('produces a row per resource, ordered by category', () => {
    expect(rows.length).toBeGreaterThan(5)
    expect(candidate).toBeTruthy()
    expect(candidate.hasPii).toBe(true) // contacts/salary field-sets
    expect(job.hasPii).toBe(false)
  })
})

describe('keysForLevel (cumulative)', () => {
  it('level 1 = read only', () => {
    expect(keysForLevel(candidate, 1)).toContain('candidate:read')
    expect(keysForLevel(candidate, 1)).not.toContain('candidate:read:contacts')
    expect(keysForLevel(candidate, 1)).not.toContain('candidate:create')
  })
  it('level 2 = read + PII field-sets', () => {
    const l2 = keysForLevel(candidate, 2)
    expect(l2).toContain('candidate:read')
    expect(l2).toContain('candidate:read:contacts')
    expect(l2).toContain('candidate:read:salary')
    expect(l2).not.toContain('candidate:create')
  })
  it('level 3 = + create/update', () => {
    const l3 = keysForLevel(candidate, 3)
    expect(l3).toContain('candidate:create')
    expect(l3).toContain('candidate:update')
    expect(l3).not.toContain('candidate:delete')
  })
  it('level 4 = + delete', () => {
    expect(keysForLevel(candidate, 4)).toContain('candidate:delete')
  })
  it('level 0 = nothing', () => {
    expect(keysForLevel(candidate, 0)).toEqual([])
  })
})

describe('levelFromGrants / isExactLevel', () => {
  it('infers the highest clean level', () => {
    expect(levelFromGrants(candidate, new Set(keysForLevel(candidate, 2)))).toBe(2)
    expect(levelFromGrants(candidate, new Set(keysForLevel(candidate, 4)))).toBe(4)
    expect(levelFromGrants(candidate, new Set())).toBe(0)
  })
  it('exact when grants equal a clean level', () => {
    expect(isExactLevel(candidate, new Set(keysForLevel(candidate, 3)))).toBe(true)
  })
  it('not exact with a fine-tuned extra (e.g. read + delete, no create/update)', () => {
    const custom = new Set(['candidate:read', 'candidate:delete'])
    expect(isExactLevel(candidate, custom)).toBe(false)
    expect(levelFromGrants(candidate, custom)).toBe(1) // only read is a clean level
  })
})

describe('MATRIX_LEVELS', () => {
  it('has 5 levels 0..4', () => {
    expect(MATRIX_LEVELS.map((l) => l.value)).toEqual([0, 1, 2, 3, 4])
  })
})
