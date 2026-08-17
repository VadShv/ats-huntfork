import { and, eq } from 'drizzle-orm'
import { hashPassword } from '@better-auth/utils/password'
import { account, member, user } from '../../database/schema'
import { createHiringManagerSchema } from '../../utils/schemas/hiringManager'
import { generateTemporaryPassword } from '../../utils/hiringManager'

/**
 * POST /api/hiring-managers
 * Создаёт учётку «Нанимающего менеджера» для лично-выдачи (Sprint 20.2).
 *
 * Отличается от обычного invite:
 *  - Юзер уже создан в БД (не self-signup через `/api/auth/sign-up`).
 *  - Пароль сгенерирован здесь и возвращается ОДИН РАЗ в ответе.
 *  - `must_change_password=true` — при первом входе НМ обязан сменить пароль.
 *  - `email_verified=true` — верификация не нужна.
 *
 * Права: `member:create` (owner/admin). Скрининг Qwen не трогается.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { member: ['create'] })
  const orgId = session.session.activeOrganizationId
  const actorId = session.user.id

  const body = await readValidatedBody(event, createHiringManagerSchema.parse)
  const normalizedEmail = body.email.toLowerCase().trim()

  // ── Проверка: юзер с таким email не должен существовать ─────
  // (В v1 запрещаем reuse существующего юзера — это упрощает выдачу пароля
  // и исключает риск непреднамеренной эскалации прав. В v2 добавим invite-flow.)
  const [existing] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, normalizedEmail))
    .limit(1)

  if (existing) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Пользователь с таким email уже существует. Используйте invite-link.',
    })
  }

  // ── Генерация пароля и хеш ──────────────────────────────────
  const tempPassword = generateTemporaryPassword()
  const passwordHash = await hashPassword(tempPassword)

  // ── Транзакция: user + credential account + member ──────────
  const result = await db.transaction(async (tx) => {
    const userId = crypto.randomUUID()
    const now = new Date()

    // 1. user (email_verified=true — рекрутёр выдаёт учётку лично)
    await tx.insert(user).values({
      id: userId,
      email: normalizedEmail,
      name: body.name.trim(),
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })

    // 2. account — credential provider с паролем
    await tx.insert(account).values({
      id: crypto.randomUUID(),
      accountId: userId, // convention Better Auth: credential accountId = user.id
      providerId: 'credential',
      userId,
      password: passwordHash,
      createdAt: now,
      updatedAt: now,
    })

    // 3. member — привязка к org с ролью hiring_manager
    const [newMember] = await tx.insert(member).values({
      id: crypto.randomUUID(),
      userId,
      organizationId: orgId,
      role: 'hiring_manager',
      status: 'active',
      hmCanViewSalary: body.canViewSalary,
      mustChangePassword: true,
      passwordUpdatedAt: null,
      approvedBy: actorId,
      approvedAt: now,
      createdAt: now,
    }).returning({ id: member.id })

    return { userId, memberId: newMember.id }
  })

  // ── Аудит ───────────────────────────────────────────────────
  await recordActivity({
    organizationId: orgId,
    actorId,
    action: 'created',
    resourceType: 'member',
    resourceId: result.memberId,
    metadata: {
      subtype: 'hiring_manager_created',
      hmUserId: result.userId,
      email: normalizedEmail,
      canViewSalary: body.canViewSalary,
    },
  })

  // ── Ответ: пароль возвращается ЕДИНОЖДЫ ─────────────────────
  // Клиент обязан показать его рекрутёру и не сохранять на сервере.
  return {
    success: true,
    user: {
      id: result.userId,
      email: normalizedEmail,
      name: body.name.trim(),
    },
    memberId: result.memberId,
    /** ⚠️ Показывается один раз. НМ обязан сменить при первом входе. */
    temporaryPassword: tempPassword,
  }
})
