/**
 * Global middleware.
 *  1. Блокирует доступ членам в статусах pending/rejected/suspended.
 *  2. Спринт 20.4: если НМ с must_change_password=true — форсит
 *     на /hm/change-password.
 *  3. Спринт 20.4: НМ не может ходить по /dashboard/* — всегда на /hm/dashboard.
 *
 * Завершается рано:
 * - No session (auth middleware will redirect to sign-in)
 * - No active org (require-org middleware will redirect to create-org)
 * - Маршрут /auth/* (анти-луп)
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

  if (!membership.value) return

  // Блокируем по статусу до всего остального
  if (membership.value.status === 'pending') {
    return navigateTo(localePath('/auth/pending-approval'))
  }
  if (membership.value.status === 'rejected' || membership.value.status === 'suspended') {
    return navigateTo(localePath('/auth/access-denied'))
  }

  // С активным членством — проверяем НМ-специфичные правила
  if (membership.value.status !== 'active') return

  const isHm = membership.value.role === 'hiring_manager'
  const isHmRoute = to.path.startsWith('/hm/') || to.path === '/hm'
    || to.path.startsWith('/ru/hm/') || to.path === '/ru/hm'

  // (2) Принудительная смена временного пароля
  if (isHm && membership.value.mustChangePassword) {
    const changePwPath = localePath('/hm/change-password')
    if (to.path !== changePwPath && !to.path.endsWith('/hm/change-password')) {
      return navigateTo(changePwPath)
    }
  }

  // (3) НМ не пускаем в админ-UI
  if (isHm && (to.path.startsWith('/dashboard') || to.path.startsWith('/ru/dashboard'))) {
    return navigateTo(localePath('/hm/dashboard'))
  }

  // Не-НМ в /hm/* — на обычный дашборд
  if (!isHm && isHmRoute) {
    return navigateTo(localePath('/dashboard'))
  }
})
