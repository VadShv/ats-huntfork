import { and, eq } from 'drizzle-orm'
import { member } from '../../../database/schema/auth'
import { hmChangePasswordSchema } from '../../../utils/schemas/hiringManager'

/**
 * POST /api/auth/hm/change-password
 * Смена временного пароля НМ.
 *
 * Особенности:
 *   - Работает и для НМ, которому must_change_password=true (иначе он никуда не мог бы попасть).
 *   - Использует Better Auth /change-password под капотом — тот же scrypt-hash, ретейнит сессию.
 *   - После успеха ставит must_change_password=false, password_updated_at=now().
 *   - Не требует роли HM в session — Better Auth сам проверит currentPassword.
 *     Но флаги гасим только если пользователь — hiring_manager в active org.
 */
export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session) {
    throw createError({ statusCode: 401, statusMessage: 'Требуется вход' })
  }

  const body = await readValidatedBody(event, hmChangePasswordSchema.parse)

  // Проксируем в Better Auth /change-password
  // Он бросит APIError если currentPassword неверен.
  try {
    await auth.api.changePassword({
      headers: event.headers,
      body: {
        currentPassword: body.currentPassword,
        newPassword: body.newPassword,
        revokeOtherSessions: true,
      },
    })
  }
  catch (err: any) {
    // Better Auth возвращает 400 при неверном текущем пароле
    const status = err?.statusCode ?? err?.status ?? 400
    throw createError({
      statusCode: status,
      statusMessage: err?.message ?? 'Не удалось сменить пароль',
    })
  }

  // Гасим must_change_password для всех HM-членств этого юзера
  // (в контексте Astra Group юзер может быть НМ сразу в нескольких org).
  const now = new Date()
  await db
    .update(member)
    .set({
      mustChangePassword: false,
      passwordUpdatedAt: now,
    })
    .where(and(
      eq(member.userId, session.user.id),
      eq(member.role, 'hiring_manager'),
    ))

  return { success: true }
})
