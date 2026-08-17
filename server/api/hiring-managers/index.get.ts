import { and, eq, desc } from 'drizzle-orm'
import { member, user } from '../../database/schema'

/**
 * GET /api/hiring-managers
 * Список всех НМ в текущей org. Используется в UI «Настройки вакансии → Команда» для селекта.
 * Права: `member:read`.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { member: ['read'] })
  const orgId = session.session.activeOrganizationId

  const rows = await db
    .select({
      userId: member.userId,
      name: user.name,
      email: user.email,
      status: member.status,
      canViewSalary: member.hmCanViewSalary,
      createdAt: member.createdAt,
    })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(and(
      eq(member.organizationId, orgId),
      eq(member.role, 'hiring_manager'),
    ))
    .orderBy(desc(member.createdAt))

  return { hiringManagers: rows }
})
