import { and, eq } from 'drizzle-orm'
import { questionPreset } from '../../../database/schema'
import { presetIdParamSchema, updatePresetSchema } from '../../../utils/schemas/preset'

/**
 * PATCH /api/question-bank/presets/:presetId — правка ЧЕРНОВИКА пресета.
 * Опубликованный иммутабелен (409). isDefault=true снимает флаг с прочих. create_draft.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { questionBank: ['create_draft'] })
  const orgId = session.session.activeOrganizationId
  const { presetId } = await getValidatedRouterParams(event, presetIdParamSchema.parse)
  const body = await readValidatedBody(event, updatePresetSchema.parse)

  const existing = await db.query.questionPreset.findFirst({
    where: and(eq(questionPreset.id, presetId), eq(questionPreset.organizationId, orgId)),
    columns: { id: true, status: true },
  })
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Пресет не найден' })
  if (existing.status === 'published') {
    throw createError({ statusCode: 409, statusMessage: 'Опубликованный пресет нельзя править. Создайте новую версию.' })
  }

  return db.transaction(async (tx) => {
    if (body.isDefault === true) {
      await tx.update(questionPreset)
        .set({ isDefault: false })
        .where(and(eq(questionPreset.organizationId, orgId), eq(questionPreset.isDefault, true)))
    }
    const patch: Record<string, unknown> = { updatedAt: new Date() }
    for (const k of ['name', 'description', 'interviewType', 'targetRoles', 'seniority', 'isDefault'] as const) {
      if (body[k] !== undefined) patch[k] = body[k]
    }
    const [updated] = await tx.update(questionPreset)
      .set(patch)
      .where(and(eq(questionPreset.id, presetId), eq(questionPreset.organizationId, orgId)))
      .returning()
    return updated
  })
})
