import { ensureCareMethodology } from '../../../utils/questions/seedCareMethodology'

/**
 * GET /api/question-bank/care/methodology — активная версия методики CARE.
 * Лениво создаёт v1 (seed), если методики ещё нет. view.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { questionBank: ['view'] })
  const orgId = session.session.activeOrganizationId
  const methodology = await ensureCareMethodology(orgId, session.user.id)
  return methodology
})
