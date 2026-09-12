import { describe, it, expect } from 'vitest'
import { applyOverrides } from '../../server/utils/access/permissionResolver'

/**
 * RBAC v2 Sprint 2 — per-member override precedence (deny wins).
 * Pure function; DB-sourced overrides are folded into the base set here.
 */

describe('applyOverrides', () => {
  it('allow override adds a capability', () => {
    const base = new Set(['job:read'])
    const out = applyOverrides(base, new Map([['job:create', 'allow']]))
    expect(out.has('job:create')).toBe(true)
    expect(out.has('job:read')).toBe(true)
  })

  it('deny override removes a capability (deny wins)', () => {
    const base = new Set(['job:read', 'job:update'])
    const out = applyOverrides(base, new Map([['job:update', 'deny']]))
    expect(out.has('job:update')).toBe(false)
    expect(out.has('job:read')).toBe(true)
  })

  it('does not mutate the base set', () => {
    const base = new Set(['job:read'])
    applyOverrides(base, new Map([['job:read', 'deny']]))
    expect(base.has('job:read')).toBe(true)
  })

  it('deny of a not-present capability is a no-op', () => {
    const base = new Set(['job:read'])
    const out = applyOverrides(base, new Map([['candidate:delete', 'deny']]))
    expect(out).toEqual(new Set(['job:read']))
  })
})
