import { desc, eq } from 'drizzle-orm'
import { careMethodology } from '../../../../database/schema'

/** GET /api/question-bank/care/methodology/versions — список версий методики. view. */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { questionBank: ['view'] })
  const orgId = session.session.activeOrganizationId

  const items = await db.query.careMethodology.findMany({
    where: eq(careMethodology.organizationId, orgId),
    orderBy: [desc(careMethodology.version)],
    columns: { id: true, version: true, isActive: true, changeNote: true, publishedAt: true, createdAt: true },
  })
  return { items }
})
