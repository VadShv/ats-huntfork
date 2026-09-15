/**
 * POST /api/hh/auto-respond/rules
 *
 * Create a new auto-respond rule.
 * Body: { name, triggerCollection, triggerDelayMinutes?, condition?, messageTemplate, isActive?, priority? }
 */
import { hhAutoRespondRule } from '../../../../database/schema'

export default defineEventHandler(async (event) => {
  const { user, session } = await requirePermission(event, { hhAutoRespond: ['create'] })
  const orgId = session.activeOrganizationId

  const body = await readBody<{
    name?: string
    triggerCollection?: string
    triggerDelayMinutes?: number
    condition?: Record<string, unknown>
    messageTemplate?: string
    isActive?: boolean
    priority?: number
  }>(event)

  const name = (body?.name ?? '').trim()
  const triggerCollection = (body?.triggerCollection ?? '').trim()
  const messageTemplate = (body?.messageTemplate ?? '').trim()

  if (!name || !triggerCollection || !messageTemplate) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Обязательны поля name, triggerCollection, messageTemplate',
    })
  }

  const [created] = await db
    .insert(hhAutoRespondRule)
    .values({
      organizationId: orgId,
      createdByUserId: user.id,
      name,
      triggerCollection,
      triggerDelayMinutes: body?.triggerDelayMinutes ?? 0,
      condition: body?.condition ?? null,
      messageTemplate,
      isActive: body?.isActive ?? true,
      priority: body?.priority ?? 100,
    })
    .returning()

  return created
})
