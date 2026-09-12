import { describe, it, expect } from 'vitest'
import { can, canBool, canRequest } from '../../server/utils/access/can'
import type { ActorContext } from '../../server/utils/access/actorContext'

/**
 * RBAC v2 Sprint 1 — can() decision-ordering tests (pure, no DB).
 */

function actor(over: Partial<ActorContext> = {}): ActorContext {
  return {
    userId: 'u1',
    memberId: 'm1',
    orgId: 'org1',
    roleKeys: ['member'],
    permissions: new Set(['job:read', 'candidate:read', 'candidate:update']),
    overrides: new Map(),
    scope: { type: 'assigned', departmentIds: [], jobIds: [] },
    limits: null,
    status: 'active',
    isViewAs: false,
    canViewSalary: false,
    mustChangePassword: false,
    ...over,
  }
}

describe('can() ordering', () => {
  it('deny when no actor', () => {
    expect(can(null, 'job:read').effect).toBe('deny')
  })

  it('allow when capability present and active', () => {
    expect(can(actor(), 'job:read')).toEqual({ effect: 'allow' })
  })

  it('deny when capability absent', () => {
    expect(can(actor(), 'job:delete').effect).toBe('deny')
  })

  it('cross-org resource → deny (IDOR guard) before capability check', () => {
    const d = can(actor(), 'job:read', { type: 'job', orgId: 'other' })
    expect(d).toEqual({ effect: 'deny', reason: 'cross_org' })
  })

  it('same-org resource passes org guard', () => {
    expect(can(actor(), 'job:read', { type: 'job', orgId: 'org1' }).effect).toBe('allow')
  })

  it('inactive/revoked member → deny regardless of caps', () => {
    expect(can(actor({ status: 'suspended' }), 'job:read').effect).toBe('deny')
    expect(can(actor({ status: 'revoked' }), 'job:read').effect).toBe('deny')
  })

  it('view-as forces read-only', () => {
    const a = actor({ isViewAs: true, permissions: new Set(['candidate:read', 'candidate:update']) })
    expect(can(a, 'candidate:read').effect).toBe('allow')
    expect(can(a, 'candidate:update').effect).toBe('deny')
  })
})

describe('canRequest()', () => {
  it('requires every action to pass', () => {
    expect(canRequest(actor(), { candidate: ['read', 'update'] }).effect).toBe('allow')
    expect(canRequest(actor(), { candidate: ['read', 'delete'] }).effect).toBe('deny')
  })
})

describe('canBool()', () => {
  it('booleanizes decisions', () => {
    expect(canBool(actor(), 'job:read')).toBe(true)
    expect(canBool(actor(), 'job:delete')).toBe(false)
  })
})
