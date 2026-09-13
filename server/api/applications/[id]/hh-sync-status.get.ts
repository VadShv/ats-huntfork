import { getHhSyncStatus } from '../../../utils/hh/sourcing/pushAction'
import { requireApplicationInScope } from '../../../utils/access/scope'
import { applicationIdParamSchema } from '../../../utils/schemas/application'

/**
 * GET /api/applications/:id/hh-sync-status
 *
 * Спринт 22 (todo 8): индикатор рассинхрона с hh.ru.
 * Возвращает, соответствует ли коллекция negotiation на hh текущему этапу
 * воронки. Ничего не изменяет — только читает.
 *
 * Ответ: { applicable, inSync?, expectedCollection?, actualCollection?, lastError?, lastAttemptAt? }
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { application: ['read'] })
  const orgId = session.session.activeOrganizationId

  const { id } = await getValidatedRouterParams(event, applicationIdParamSchema.parse)
  await requireApplicationInScope(event, id as string, orgId)

  return await getHhSyncStatus({ organizationId: orgId, applicationId: id })
})
