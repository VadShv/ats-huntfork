/**
 * Гард для endpoints /api/hm/* — проверяет что залогинен НМ этой org.
 *
 * Отличия от requireAuth/requirePermission:
 *   - Роль ДОЛЖНА быть 'hiring_manager' (не 'admin' и не 'member').
 *   - НМ обязан быть active.
 *   - Не проверяет must_change_password (это делает отдельный middleware,
 *     чтобы НМ мог зайти на /auth/hm/change-password для смены).
 *
 * Возвращает те же поля, что requirePermission — session + user + активная org.
 */

import type { H3Event } from 'h3'
import { and, eq } from 'drizzle-orm'
import { member } from '../database/schema/auth'

export interface HmSession {
  user: { id: string; email: string; name: string }
  session: { activeOrganizationId: string }
  hm: {
    memberId: string
    canViewSalary: boolean
    mustChangePassword: boolean
  }
}

export async function requireHm(event: H3Event): Promise<HmSession> {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session) {
    throw createError({ statusCode: 401, statusMessage: 'Требуется вход' })
  }

  const orgId = session.session.activeOrganizationId
  if (!orgId) {
    throw createError({ statusCode: 400, statusMessage: 'Не выбрана организация' })
  }

  const [row] = await db
    .select({
      id: member.id,
      role: member.role,
      status: member.status,
      canViewSalary: member.hmCanViewSalary,
      mustChangePassword: member.mustChangePassword,
    })
    .from(member)
    .where(and(
      eq(member.organizationId, orgId),
      eq(member.userId, session.user.id),
    ))
    .limit(1)

  if (!row) {
    throw createError({ statusCode: 403, statusMessage: 'Нет доступа к организации' })
  }
  if (row.role !== 'hiring_manager') {
    throw createError({ statusCode: 403, statusMessage: 'Требуется роль «Нанимающий менеджер»' })
  }
  if (row.status !== 'active') {
    throw createError({ statusCode: 403, statusMessage: 'Учётная запись неактивна' })
  }

  return {
    user: {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name ?? '',
    },
    session: { activeOrganizationId: orgId },
    hm: {
      memberId: row.id,
      canViewSalary: row.canViewSalary,
      mustChangePassword: row.mustChangePassword,
    },
  }
}
