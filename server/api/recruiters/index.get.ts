import { and, eq, inArray, desc } from 'drizzle-orm'
import { member, user } from '../../database/schema'

/**
 * GET /api/recruiters
 * Список всех участников org, которые могут вести вакансии как рекрутеры:
 * org-роли owner / admin / member. Используется в UI
 * «Настройки вакансии → Рекрутеры» для селекта назначения.
 * Права: `job:read`. PII не выдаём — только имя, email, роль и статус.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { job: ['read'] })
  const orgId = session.session.activeOrganizationId

  const rows = await db
    .select({
      userId: member.userId,
      name: user.name,
      email: user.email,
      role: member.role,
      status: member.status,
      createdAt: member.createdAt,
    })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(and(
      eq(member.organizationId, orgId),
      inArray(member.role, ['owner', 'admin', 'member']),
    ))
    .orderBy(desc(member.createdAt))

  return { recruiters: rows }
})
