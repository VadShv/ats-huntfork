import { getActorContext, actorToSnapshot } from '../../../utils/access/actorContext'

/**
 * GET /api/auth/me/membership
 *
 * Returns the current user's member record in their active organization plus an
 * `access` snapshot (RBAC v2, Sprint 0.5) used by the client to gate UI
 * synchronously on SSR — no Better Auth roundtrip, no flicker.
 *
 * Returns null if the user has no session or no active organization.
 *
 * Backward compatible: the top-level fields (id, role, status,
 * mustChangePassword, hmCanViewSalary, ...) are preserved for existing
 * middleware; `access` is additive.
 */
export default defineEventHandler(async (event) => {
  const actor = await getActorContext(event)

  if (!actor) {
    return null
  }

  return {
    id: actor.memberId,
    userId: actor.userId,
    organizationId: actor.orgId,
    role: actor.roleKeys[0] ?? null,
    status: actor.status,
    mustChangePassword: actor.mustChangePassword,
    hmCanViewSalary: actor.canViewSalary,
    // ── RBAC v2 access snapshot (Sprint 0.5) ──
    access: actorToSnapshot(actor),
  }
})
