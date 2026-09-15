/**
 * GET /api/hh/templates
 *
 * List vacancy templates for the current org. Returns org-wide shared
 * templates plus the user's own private templates.
 */
import { and, desc, eq, or } from 'drizzle-orm'
import { hhVacancyTemplate } from '../../../database/schema'

export default defineEventHandler(async (event) => {
  const { user, session } = await requirePermission(event, { hhTemplate: ['read'] })
  const orgId = session.activeOrganizationId

  const templates = await db
    .select()
    .from(hhVacancyTemplate)
    .where(and(
      eq(hhVacancyTemplate.organizationId, orgId),
      or(
        eq(hhVacancyTemplate.isShared, true),
        eq(hhVacancyTemplate.createdByUserId, user.id),
      ),
    ))
    .orderBy(desc(hhVacancyTemplate.updatedAt))

  return templates
})
