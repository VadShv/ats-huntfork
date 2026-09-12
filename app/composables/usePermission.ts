import type { statements } from '~~/shared/permissions'
import { snapshotCan, type PermissionRequest as SnapshotRequest } from '~~/shared/access/capabilities'

/**
 * Permission descriptor — same shape as the server-side PermissionRequest.
 * Maps a resource to the actions being checked.
 *
 * Example: `{ job: ['create'] }` or `{ candidate: ['read', 'update'] }`
 */
type PermissionRequest = {
  [K in keyof typeof statements]?: ReadonlyArray<(typeof statements)[K][number]>
}

/**
 * ─────────────────────────────────────────────
 * usePermission — client-side permission gating (RBAC v2, Sprint 0.5)
 * ─────────────────────────────────────────────
 *
 * Reactive `allowed` indicating whether the current user's access snapshot
 * satisfies the given permission set.
 *
 * Sprint 0.5 change: reads the SSR-provided access snapshot SYNCHRONOUSLY via
 * `useAccessSnapshot()` instead of the old async `getActiveMemberRole()` +
 * client Better Auth AC. This removes UI flicker (role is known on first render)
 * and correctly handles `hiring_manager` (previously unregistered client-side).
 *
 * **Important:** client-side checks are cosmetic only. Real enforcement is
 * server-side via `requirePermission()`.
 *
 * Signature is UNCHANGED — existing call sites work without edits:
 * ```vue
 * const { allowed: canCreateJob } = usePermission({ job: ['create'] })
 * ```
 */
export function usePermission(permissions: PermissionRequest) {
  const { snapshot, isLoading } = useAccessSnapshot()

  const role = computed<string | null>(() => snapshot.value.roleKeys[0] ?? null)

  const allowed = computed(() =>
    snapshotCan(snapshot.value, permissions as SnapshotRequest),
  )

  return { allowed, role: readonly(role), isLoading: readonly(isLoading) }
}

/**
 * ─────────────────────────────────────────────
 * usePermissions — new capability API (master plan §8.7)
 * ─────────────────────────────────────────────
 *
 * Preferred going forward. Returns imperative `can`/`cannot` plus reactive
 * `scope`, `masked` (reserved for field masking), `role` and `isReady`.
 *
 * ```vue
 * const { can } = usePermissions()
 * <UButton v-if="can({ candidate: ['export'] })" ... />
 * ```
 */
export function usePermissions() {
  const { snapshot, isLoading } = useAccessSnapshot()

  const can = (permissions: PermissionRequest) =>
    snapshotCan(snapshot.value, permissions as SnapshotRequest)
  const cannot = (permissions: PermissionRequest) => !can(permissions)

  const role = computed<string | null>(() => snapshot.value.roleKeys[0] ?? null)
  const scope = computed(() => snapshot.value.scope)
  const isReady = computed(() => !isLoading.value)

  return { can, cannot, role: readonly(role), scope, isReady }
}
