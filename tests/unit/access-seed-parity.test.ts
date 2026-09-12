import { describe, it, expect } from 'vitest'
import { expandRoleCapabilities } from '../../shared/access/capabilities'
import { ROLE_PRESET_BY_KEY, ROLE_PRESETS } from '../../shared/access/role-presets'
import { allPermissionKeys, buildPermissionCatalog } from '../../shared/access/catalog'

/**
 * RBAC v2 Sprint 1 — seed parity guarantees.
 * The DB seed for owner/admin/member/hiring_manager MUST equal the static
 * Better Auth AC capability set, so shadow-mode diverges nowhere.
 */

describe('preset ⇄ static AC parity', () => {
  // Sprint 3: owner/admin/member additionally carry the PII field-set grants
  // (contacts/salary) which the static AC never modeled. Parity = static ∪ PII.
  const PII = ['candidate:read:contacts', 'candidate:read:salary']
  const withPii: Record<string, string[]> = { owner: PII, admin: PII, member: PII, hiring_manager: [] }
  for (const key of ['owner', 'admin', 'member', 'hiring_manager']) {
    it(`${key} preset capabilities == static expansion (+PII where applicable)`, () => {
      const preset = new Set(ROLE_PRESET_BY_KEY[key].capabilities)
      const expected = new Set([...expandRoleCapabilities(key), ...withPii[key]])
      expect(preset).toEqual(expected)
    })
  }

  it('hiring_manager and junior_recruiter do NOT get PII grants', () => {
    expect(new Set(ROLE_PRESET_BY_KEY.hiring_manager.capabilities).has('candidate:read:contacts')).toBe(false)
    expect(new Set(ROLE_PRESET_BY_KEY.junior_recruiter.capabilities).has('candidate:read:contacts')).toBe(false)
    expect(new Set(ROLE_PRESET_BY_KEY.junior_recruiter.capabilities).has('candidate:read:salary')).toBe(false)
  })

  it('owner/admin include platform capabilities (member/invitation)', () => {
    const owner = new Set(ROLE_PRESET_BY_KEY.owner.capabilities)
    expect(owner.has('member:create')).toBe(true)
    expect(owner.has('invitation:cancel')).toBe(true)
    const admin = new Set(ROLE_PRESET_BY_KEY.admin.capabilities)
    expect(admin.has('member:create')).toBe(true)
    expect(admin.has('invitation:create')).toBe(true)
  })

  it('member/hiring_manager do NOT grant member:create', () => {
    expect(new Set(ROLE_PRESET_BY_KEY.member.capabilities).has('member:create')).toBe(false)
    expect(new Set(ROLE_PRESET_BY_KEY.hiring_manager.capabilities).has('member:create')).toBe(false)
  })
})

describe('permission catalog', () => {
  it('contains every capability referenced by every preset', () => {
    const catalog = allPermissionKeys()
    const missing: string[] = []
    for (const preset of ROLE_PRESETS) {
      for (const cap of preset.capabilities) {
        if (!catalog.has(cap)) missing.push(`${preset.key}:${cap}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('includes PII field-set permissions for candidate', () => {
    const catalog = allPermissionKeys()
    expect(catalog.has('candidate:read:contacts')).toBe(true)
    expect(catalog.has('candidate:read:salary')).toBe(true)
  })

  it('has no duplicate keys', () => {
    const entries = buildPermissionCatalog()
    const keys = entries.map((e) => e.key)
    expect(keys.length).toBe(new Set(keys).size)
  })

  it('marks export and contacts as critical risk', () => {
    const byKey = Object.fromEntries(buildPermissionCatalog().map((e) => [e.key, e]))
    expect(byKey['candidate:read:contacts'].riskLevel).toBe(2)
  })
})

describe('lead_recruiter default (AI view-only example)', () => {
  it('can view scoring/AI config but not edit it', () => {
    const caps = new Set(ROLE_PRESET_BY_KEY.lead_recruiter.capabilities)
    expect(caps.has('scoring:read')).toBe(true)
    expect(caps.has('scoring:create')).toBe(false)
  })

  it('defaults to org scope (§2)', () => {
    expect(ROLE_PRESET_BY_KEY.lead_recruiter.defaultScope).toBe('org')
  })
})

describe('junior_recruiter is minimal', () => {
  it('cannot update candidates or delete anything', () => {
    const caps = new Set(ROLE_PRESET_BY_KEY.junior_recruiter.capabilities)
    expect(caps.has('candidate:update')).toBe(false)
    for (const c of caps) expect(c.endsWith(':delete')).toBe(false)
  })
})
