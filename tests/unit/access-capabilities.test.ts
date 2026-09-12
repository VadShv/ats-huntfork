import { describe, it, expect } from 'vitest'
import {
  expandRoleCapabilities,
  expandRolesCapabilities,
  snapshotCan,
  emptyAccessSnapshot,
  type AccessSnapshot,
} from '../../shared/access/capabilities'
import { ROLE_ATS_STATEMENTS } from '../../shared/permissions'

/**
 * RBAC v2, Sprint 0.5 — matrix tests for the pure capability engine.
 * No DB, no I/O: builds snapshots directly and asserts allow/deny per plan §13.0.
 */

function snapshotForRole(roleKey: string, over: Partial<AccessSnapshot> = {}): AccessSnapshot {
  return {
    roleKeys: [roleKey],
    capabilities: Array.from(expandRoleCapabilities(roleKey)),
    scope: { type: 'org', departmentIds: [], jobIds: [] },
    flags: { canViewSalary: false, mustChangePassword: false, isViewAs: false },
    status: 'active',
    ...over,
  }
}

describe('expandRoleCapabilities', () => {
  it('expands owner into resource:action strings', () => {
    const caps = expandRoleCapabilities('owner')
    expect(caps.has('job:delete')).toBe(true)
    expect(caps.has('candidate:read')).toBe(true)
    expect(caps.has('organization:delete')).toBe(true)
  })

  it('member (recruiter) cannot delete jobs but can update them', () => {
    const caps = expandRoleCapabilities('member')
    expect(caps.has('job:update')).toBe(true)
    expect(caps.has('job:delete')).toBe(false)
  })

  it('hiring_manager is read-only across ATS resources', () => {
    const caps = expandRoleCapabilities('hiring_manager')
    for (const cap of caps) {
      expect(cap.endsWith(':read')).toBe(true)
    }
  })

  it('unknown role yields empty set (deny-by-default)', () => {
    expect(expandRoleCapabilities('nope').size).toBe(0)
  })
})

describe('expandRolesCapabilities (union)', () => {
  it('unions member + hiring_manager', () => {
    const caps = expandRolesCapabilities(['member', 'hiring_manager'])
    expect(caps.has('job:update')).toBe(true) // from member
    expect(caps.has('job:read')).toBe(true) // from both
  })
})

describe('snapshotCan — role × permission matrix', () => {
  const roles = Object.keys(ROLE_ATS_STATEMENTS)

  // Generated matrix: every role × every declared resource:action.
  for (const role of roles) {
    const declared = expandRoleCapabilities(role)
    const snap = snapshotForRole(role)
    for (const cap of declared) {
      const [resource, action] = cap.split(':')
      it(`${role} allowed for ${cap}`, () => {
        expect(snapshotCan(snap, { [resource]: [action] })).toBe(true)
      })
    }
  }

  it('denies actions not granted to the role', () => {
    expect(snapshotCan(snapshotForRole('member'), { job: ['delete'] })).toBe(false)
    expect(snapshotCan(snapshotForRole('hiring_manager'), { candidate: ['update'] })).toBe(false)
  })

  it('denies everything for empty snapshot', () => {
    expect(snapshotCan(emptyAccessSnapshot(), { job: ['read'] })).toBe(false)
    expect(snapshotCan(null, { job: ['read'] })).toBe(false)
  })

  it('requires ALL actions in a multi-action request', () => {
    const snap = snapshotForRole('member')
    expect(snapshotCan(snap, { candidate: ['read', 'update'] })).toBe(true)
    expect(snapshotCan(snap, { candidate: ['read', 'delete'] })).toBe(false)
  })

  it('view-as forces read-only even when the role can write', () => {
    const viewAs = snapshotForRole('owner', {
      flags: { canViewSalary: false, mustChangePassword: false, isViewAs: true },
    })
    expect(snapshotCan(viewAs, { job: ['read'] })).toBe(true)
    expect(snapshotCan(viewAs, { job: ['update'] })).toBe(false)
    expect(snapshotCan(viewAs, { job: ['delete'] })).toBe(false)
  })
})
