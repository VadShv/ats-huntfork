import { eq, and, asc, desc, count } from 'drizzle-orm'
import { z } from 'zod'
import { searchMapTemplate, searchMapTemplateSection, jobSearchMap } from '../../../database/schema/app'

/**
 * GET /api/search-map/templates — список шаблонов орг.
 * Право: searchMap:view. Сид дефолтного при отсутствии.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { searchMap: ['view'] })
  const orgId = session.session.activeOrganizationId

  await ensureDefaultTemplate(orgId)

  const q = getQuery(event)
  const statusFilter = typeof q.status === 'string' ? q.status : undefined

  const conds = [eq(searchMapTemplate.organizationId, orgId)]
  if (statusFilter) conds.push(eq(searchMapTemplate.status, statusFilter as 'draft' | 'published' | 'archived'))

  const templates = await db.select({
    id: searchMapTemplate.id,
    code: searchMapTemplate.code,
    name: searchMapTemplate.name,
    description: searchMapTemplate.description,
    targetRoles: searchMapTemplate.targetRoles,
    isDefault: searchMapTemplate.isDefault,
    status: searchMapTemplate.status,
    version: searchMapTemplate.version,
    publishedAt: searchMapTemplate.publishedAt,
    createdAt: searchMapTemplate.createdAt,
    updatedAt: searchMapTemplate.updatedAt,
    sectionCount: count(searchMapTemplateSection.id),
  })
    .from(searchMapTemplate)
    .leftJoin(searchMapTemplateSection, eq(searchMapTemplateSection.templateId, searchMapTemplate.id))
    .where(and(...conds))
    .groupBy(searchMapTemplate.id)
    .orderBy(desc(searchMapTemplate.isDefault), asc(searchMapTemplate.name))

  return { items: templates }
})
