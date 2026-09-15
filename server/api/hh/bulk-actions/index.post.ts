/**
 * POST /api/hh/bulk-actions
 *
 * Create a new bulk action and enqueue it for processing.
 */
import { getBoss } from '../../../utils/queue/boss'
import { hhBulkAction } from '../../../database/schema'
import { HH_BULK_ACTION_QUEUE } from '../../../utils/hh/bulkActions'

export default defineEventHandler(async (event) => {
  const { user, session } = await requirePermission(event, { hhBulkAction: ['execute'] })

  const body = await readBody<{
    actionType?: string
    targetType?: string
    itemIds?: string[]
    filter?: Record<string, unknown>
    params?: { collection?: string, messageText?: string }
  }>(event)

  if (!body?.actionType || !body?.targetType) {
    throw createError({ statusCode: 400, statusMessage: 'Обязательны поля actionType, targetType' })
  }
  if (!body.itemIds?.length && !body.filter) {
    throw createError({ statusCode: 400, statusMessage: 'Нужны itemIds или filter' })
  }

  const [action] = await db
    .insert(hhBulkAction)
    .values({
      organizationId: session.activeOrganizationId,
      initiatedByUserId: user.id,
      actionType: body.actionType,
      targetType: body.targetType,
      itemIds: body.itemIds,
      filter: body.filter,
      params: body.params,
      status: 'pending',
    })
    .returning()

  if (!action) {
    throw createError({ statusCode: 500, statusMessage: 'Не удалось создать действие' })
  }

  const boss = await getBoss()
  await boss.send({
    name: HH_BULK_ACTION_QUEUE,
    data: { bulkActionId: action.id },
    options: { retryLimit: 2, retryDelay: 30, retryBackoff: true },
  } as any)

  return action
})
