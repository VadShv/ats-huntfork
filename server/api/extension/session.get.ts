/**
 * GET /api/extension/session
 *
 * Проверка SSO для Chrome-расширения. Расширение зовёт этот эндпоинт через
 * background-script с `credentials: 'include'`, чтобы убедиться, что
 * пользователь залогинен на huntfork.ru.
 *
 * Если cookie сессии есть — возвращаем профиль и активную организацию.
 * Если нет — 401, расширение покажет «Войдите в Huntfork».
 *
 * CORS: см. server/middleware/cors-extension.ts — Origin chrome-extension://*
 * разрешён с credentials.
 */

export default defineEventHandler(async (event) => {
  // Не используем requirePermission — нам не нужны permission'ы,
  // только базовый факт аутентификации.
  const session = await auth.api.getSession({ headers: event.headers })

  if (!session) {
    throw createError({ statusCode: 401, statusMessage: 'Не залогинен на huntfork.ru' })
  }

  const activeOrgId = (session.session as { activeOrganizationId?: string }).activeOrganizationId
  if (!activeOrgId) {
    throw createError({ statusCode: 403, statusMessage: 'Не выбрана активная организация' })
  }

  return {
    ok: true as const,
    user: {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
    },
    organization: {
      id: activeOrgId,
    },
  }
})
