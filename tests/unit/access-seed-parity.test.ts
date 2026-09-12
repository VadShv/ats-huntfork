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
  // (contacts/salary) + §7 hiringManager:create which the static AC never
  // modeled. Parity = static ∪ these extras.
  const PII = ['candidate:read:contacts', 'candidate:read:salary']
  const HM = ['hiringManager:create']
  const extra: Record<string, string[]> = {
    owner: [...PII, ...HM], admin: [...PII, ...HM], member: [...PII, ...HM], hiring_manager: [],
  }
  for (const key of ['owner', 'admin', 'member', 'hiring_manager']) {
    it(`${key} preset capabilities == static expansion (+extras where applicable)`, () => {
      const preset = new Set(ROLE_PRESET_BY_KEY[key].capabilities)
      const expected = new Set([...expandRoleCapabilities(key), ...extra[key]])
      expect(preset).toEqual(expected)
    })
  }

  it('§7: owner/admin/member/lead can add hiring managers; external cannot', () => {
    for (const k of ['owner', 'admin', 'member', 'lead_recruiter']) {
      expect(new Set(ROLE_PRESET_BY_KEY[k].capabilities).has('hiringManager:create')).toBe(true)
    }
    expect(new Set(ROLE_PRESET_BY_KEY.external_recruiter.capabilities).has('hiringManager:create')).toBe(false)
    expect(new Set(ROLE_PRESET_BY_KEY.hiring_manager.capabilities).has('hiringManager:create')).toBe(false)
    // member must NOT have full member:create (only owner/admin do)
    expect(new Set(ROLE_PRESET_BY_KEY.member.capabilities).has('member:create')).toBe(false)
  })

  it('hiring_manager and external_recruiter do NOT get PII grants', () => {
    expect(new Set(ROLE_PRESET_BY_KEY.hiring_manager.capabilities).has('candidate:read:contacts')).toBe(false)
    expect(new Set(ROLE_PRESET_BY_KEY.external_recruiter.capabilities).has('candidate:read:contacts')).toBe(false)
    expect(new Set(ROLE_PRESET_BY_KEY.external_recruiter.capabilities).has('candidate:read:salary')).toBe(false)
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

describe('external_recruiter (§8) is minimal, no AI, but can run interviews', () => {
  const caps = () => new Set(ROLE_PRESET_BY_KEY.external_recruiter.capabilities)

  it('cannot update candidates or delete anything', () => {
    expect(caps().has('candidate:update')).toBe(false)
    for (const c of caps()) expect(c.endsWith(':delete')).toBe(false)
  })

  it('has NO AI (scoring) and NO activity log', () => {
    for (const c of caps()) expect(c.startsWith('scoring:')).toBe(false)
    expect(caps().has('activityLog:read')).toBe(false)
  })

  it('CAN create/read/update interviews (must schedule for own jobs)', () => {
    expect(caps().has('interview:create')).toBe(true)
    expect(caps().has('interview:read')).toBe(true)
    expect(caps().has('interview:update')).toBe(true)
  })

  it('can move applications through stages of own jobs', () => {
    expect(caps().has('application:update')).toBe(true)
  })
})
