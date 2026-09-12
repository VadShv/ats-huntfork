import type { H3Event } from 'h3'
import type { statements } from '~~/shared/permissions'
import { getActorContext } from './access/actorContext'
import { canRequest } from './access/can'

/**
 * Permission descriptor — maps a resource to the actions being requested.
 *
 * Example: `{ job: ['create'] }` or `{ candidate: ['read', 'update'] }`
 *
 * The type is derived from the shared `statements` constant so that
 * every resource and action is validated at compile time.
 */
type PermissionRequest = {
  [K in keyof typeof statements]?: ReadonlyArray<(typeof statements)[K][number]>
}

type AuthSession = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>
type AuthSessionWithActiveOrg = Omit<AuthSession, 'session'> & {
  session: AuthSession['session'] & {
    activeOrganizationId: string
  }
}

/**
 * ─────────────────────────────────────────────────────────────────────
 * requirePermission — the ONLY way to gate an API route.
 * ─────────────────────────────────────────────────────────────────────
 *
 * 1. Authenticates the user (401 if no session).
 * 2. Verifies an active organization is selected (403 if not).
 * 3. Checks the requested permission(s) (403 if denied).
 *
 * **RBAC v2 (Sprint 1) — enforcement mode via `env.ACCESS_ENFORCEMENT`:**
 *   • 'old'    — legacy Better Auth AC (`auth.api.hasPermission`) decides.
 *   • 'shadow' — legacy AC decides AND the new `can()` engine is evaluated in
 *                parallel; divergences are logged (no behavior change). DEFAULT.
 *   • 'new'    — `can()` (DB-driven) decides; legacy AC not consulted.
 *
 * The signature is UNCHANGED so ~295 call sites need no edits (master plan §3.4).
 *
 * **Deny-by-default**: if a permission isn't granted, this throws 403.
 */
export async function requirePermission(
  event: H3Event,
  permissions: PermissionRequest,
): Promise<AuthSessionWithActiveOrg> {
  // ── Step 1: Authenticate ──
  const session = await auth.api.getSession({
    headers: event.headers,
  })

  if (!session) {
    throw createError({ statusCode: 401, statusMessage: 'Требуется вход' })
  }

  // ── Step 2: Active organization ──
  const activeOrganizationId = (session.session as { activeOrganizationId?: string }).activeOrganizationId

  if (!activeOrganizationId) {
    throw createError({ statusCode: 403, statusMessage: 'Нет активной организации' })
  }

  const mode = env.ACCESS_ENFORCEMENT

  // ── New engine decision (can()) — needed for 'shadow' and 'new' ──
  let newDenied: { denied: boolean; reason?: string } | null = null
  if (mode === 'shadow' || mode === 'new') {
    try {
      const actor = await getActorContext(event)
      const decision = canRequest(actor, permissions as Record<string, ReadonlyArray<string>>)
      newDenied = { denied: decision.effect === 'deny', reason: decision.effect === 'deny' ? decision.reason : undefined }
    }
    catch (err) {
      // Never let the new path break the request in shadow/transition.
      logWarn('rbac.can_eval_failed', {
        error_message: err instanceof Error ? err.message : String(err),
      })
      newDenied = null
    }
  }

  // ── Legacy engine decision (Better Auth AC) — needed for 'old' and 'shadow' ──
  let oldDenied: boolean | null = null
  if (mode === 'old' || mode === 'shadow') {
    const { error } = await (auth.api as any).hasPermission({
      headers: event.headers,
      body: { permissions: permissions as Record<string, string[]> },
    })
    oldDenied = Boolean(error)
  }

  // ── Shadow-mode: log divergence, enforce with legacy ──
  if (mode === 'shadow') {
    if (newDenied && oldDenied !== null && newDenied.denied !== oldDenied) {
      logWarn('rbac.shadow_divergence', {
        permissions: JSON.stringify(permissions),
        org_id: activeOrganizationId,
        user_id: session.user.id,
        old_denied: String(oldDenied),
        new_denied: String(newDenied.denied),
        new_reason: newDenied.reason ?? '',
      })
    }
    if (oldDenied) {
      throw createError({ statusCode: 403, statusMessage: 'Нет доступа: недостаточно прав' })
    }
  }
  // ── New-only enforcement ──
  else if (mode === 'new') {
    if (!newDenied || newDenied.denied) {
      throw createError({ statusCode: 403, statusMessage: 'Нет доступа: недостаточно прав' })
    }
  }
  // ── Legacy-only enforcement ──
  else {
    if (oldDenied) {
      throw createError({ statusCode: 403, statusMessage: 'Нет доступа: недостаточно прав' })
    }
  }

  return {
    ...session,
    session: {
      ...session.session,
      activeOrganizationId,
    },
  } as AuthSessionWithActiveOrg
}
