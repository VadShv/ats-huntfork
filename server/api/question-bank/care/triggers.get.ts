import { asc, eq } from 'drizzle-orm'
import { careProbeTrigger } from '../../../database/schema'
import { ensureCareMethodology } from '../../../utils/questions/seedCareMethodology'

/** GET /api/question-bank/care/triggers — справочник probe-триггеров. view. */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { questionBank: ['view'] })
  const orgId = session.session.activeOrganizationId
  await ensureCareMethodology(orgId, session.user.id) // seed builtin-триггеров

  const items = await db.query.careProbeTrigger.findMany({
    where: eq(careProbeTrigger.organizationId, orgId),
    orderBy: [asc(careProbeTrigger.displayOrder)],
  })
  return { items }
})
