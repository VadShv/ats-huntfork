/**
 * Global middleware — blocks access to dashboard pages for members whose
 * status is 'pending', 'rejected', or 'suspended'.
 *
 * Runs on every navigation but exits early if:
 * - No session (auth middleware will redirect to sign-in)
 * - No active org (require-org middleware will redirect to create-org)
 * - The destination is an /auth/* page (prevents redirect loops)
 */
export default defineNuxtRouteMiddleware(async (to) => {
  // Avoid infinite redirect loop on auth pages
  if (to.path.startsWith('/auth/') || to.path.startsWith('/ru/auth/')) return

  const { data: session } = await authClient.useSession(useFetch)
  const localePath = useLocalePath()

  // Not logged in — defer to auth middleware
  if (!session.value) return

  // No active org — defer to require-org middleware
  if (!session.value.session.activeOrganizationId) return

  const { data: membership } = await useFetch('/api/auth/me/membership', {
    key: `membership-${session.value.user.id}-${session.value.session.activeOrganizationId}`,
  })

  // No membership record yet or status is active — allow through
  if (!membership.value || membership.value.status === 'active') return

  if (membership.value.status === 'pending') {
    return navigateTo(localePath('/auth/pending-approval'))
  }

  if (membership.value.status === 'rejected' || membership.value.status === 'suspended') {
    return navigateTo(localePath('/auth/access-denied'))
  }
})
