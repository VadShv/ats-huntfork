import { and, eq, ilike, or } from 'drizzle-orm'
import { application } from '../../../database/schema/app'
import { member, user } from '../../../database/schema/auth'
import { applicationIdParamSchema } from '../../../utils/schemas/application'
import { orgMemberSearchSchema } from '../../../utils/schemas/applicationComment'

/**
 * GET /api/applications/:id/members?q=&limit=
 * Returns active org members matching the search query.
 * Used by the @mention autocomplete in CommentComposer.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { application: ['read'] })
  const orgId = session.session.activeOrganizationId

  const { id } = await getValidatedRouterParams(event, applicationIdParamSchema.parse)
  const query = await getValidatedQuery(event, orgMemberSearchSchema.parse)

  // Verify the application exists in this org (avoids info-leak via blind member lookup)
  const app = await db.query.application.findFirst({
    where: and(eq(application.id, id), eq(application.organizationId, orgId)),
    columns: { id: true },
  })
  if (!app) throw createError({ statusCode: 404, statusMessage: 'Отклик не найден' })

  const whereClauses = [eq(member.organizationId, orgId), eq(member.status, 'active')]
  if (query.q) {
    const pattern = `%${query.q}%`
    whereClauses.push(or(ilike(user.name, pattern), ilike(user.email, pattern))!)
  }

  const rows = await db
    .select({
      userId: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      role: member.role,
    })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(and(...whereClauses))
    .limit(query.limit)
    .orderBy(user.name)

  return { data: rows }
})
