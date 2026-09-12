/**
 * ─────────────────────────────────────────────
 * Field masking (RBAC v2, Sprint 3) — masking-on-output BY DEFAULT
 * ─────────────────────────────────────────────
 *
 * Removes PII fields the actor lacks permission to see and reports them in
 * `_masked`. Driven by the resource registry (shared/access/resources.ts):
 * each field maps to a required permission key.
 *
 * Invariant (security-invariants D1): masking is applied on OUTPUT for every
 * sensitive resource — lists, detail, exports, AI context. Returning an
 * unmasked object is an explicit exception, never the default.
 *
 * Candidate specifics:
 *   • contacts: email, phone, telegram, linkedin, github  → candidate:read:contacts
 *   • salary lives inside candidate.hhResumeRaw.salary + derived expectedSalary
 *                                                        → candidate:read:salary
 */

import type { ActorContext } from './actorContext'
import { RESOURCES } from '../../../shared/access/resources'

// Registry-driven (master plan §6): field → required permission comes from
// RESOURCES.candidate.fields. We derive the list of contact fields (those
// gated by candidate:read:contacts) instead of hardcoding, so adding a new
// contact field in the registry automatically masks it.
const CANDIDATE_CONTACT_FIELDS = Object.entries(RESOURCES.candidate.fields ?? {})
  .filter(([, perm]) => perm === 'candidate:read:contacts')
  .map(([field]) => field)

export interface MaskResult<T> {
  data: T & { _masked?: string[] }
}

/**
 * Mask a candidate-shaped object in place-safe fashion (returns a new object).
 * Nulls out contact fields without `candidate:read:contacts` and salary data
 * without `candidate:read:salary`. Always sets `_masked` (possibly []).
 */
export function maskCandidate<T extends Record<string, unknown>>(
  actor: ActorContext | null,
  row: T,
): T & { _masked: string[] } {
  const out: Record<string, unknown> = { ...row }
  const masked: string[] = []

  const canContacts = Boolean(actor?.permissions.has('candidate:read:contacts'))
  const canSalary = Boolean(actor?.permissions.has('candidate:read:salary'))

  if (!canContacts) {
    for (const f of CANDIDATE_CONTACT_FIELDS) {
      if (f in out && out[f] != null) {
        out[f] = null
        masked.push(f)
      }
    }
  }

  if (!canSalary) {
    // Derived expectedSalary (e.g. HM payload shape)
    if ('expectedSalary' in out && out.expectedSalary != null) {
      out.expectedSalary = null
      masked.push('expectedSalary')
    }
    // Salary embedded in the raw resume snapshot
    if ('hhResumeRaw' in out && out.hhResumeRaw && typeof out.hhResumeRaw === 'object') {
      const raw = out.hhResumeRaw as Record<string, unknown>
      if (raw.salary != null) {
        out.hhResumeRaw = { ...raw, salary: null }
        masked.push('hhResumeRaw.salary')
      }
    }
  }

  out._masked = masked
  return out as T & { _masked: string[] }
}

/** Mask a list of candidate-shaped rows. */
export function maskCandidates<T extends Record<string, unknown>>(
  actor: ActorContext | null,
  rows: T[],
): Array<T & { _masked: string[] }> {
  return rows.map((r) => maskCandidate(actor, r))
}

/**
 * Convenience: does the actor see candidate contacts? (for endpoints that fetch
 * live contact data, e.g. open-hh-contacts).
 */
export function canReadContacts(actor: ActorContext | null): boolean {
  return Boolean(actor?.permissions.has('candidate:read:contacts'))
}

export function canReadSalary(actor: ActorContext | null): boolean {
  return Boolean(actor?.permissions.has('candidate:read:salary'))
}
