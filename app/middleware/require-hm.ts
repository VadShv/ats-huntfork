/**
 * require-hm — гард для /hm/* маршрутов.
 * Требует активный аккаунт с role='hiring_manager' в active org.
 *
 * Порядок в цепочке: auth → require-org → require-hm.
 *
 * Смена пароля не проверяется здесь — этим занимается глобальный
 * middleware `require-approved-member.global.ts`, чтобы работать
 * одинаково на всех маршрутах.
 */
export default defineNuxtRouteMiddleware(async () => {
  const { data: session } = await authClient.useSession(useFetch)
  const localePath = useLocalePath()

  if (!session.value) {
    return navigateTo(localePath('/auth/sign-in'))
  }

  const activeOrgId = session.value.session.activeOrganizationId
  if (!activeOrgId) {
    return navigateTo(localePath('/onboarding/create-org'))
  }

  const { data: membership } = await useFetch('/api/auth/me/membership', {
    key: `membership-${session.value.user.id}-${activeOrgId}`,
  })

  if (!membership.value || membership.value.role !== 'hiring_manager') {
    // Не НМ — на общий дашборд
    return navigateTo(localePath('/dashboard'))
  }

  if (membership.value.status !== 'active') {
    return navigateTo(localePath('/auth/pending-approval'))
  }
})
