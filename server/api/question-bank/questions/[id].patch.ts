import { and, eq } from 'drizzle-orm'
import { bankQuestion } from '../../../database/schema'
import { bankQuestionIdParamSchema, updateBankQuestionSchema } from '../../../utils/schemas/bankQuestion'
import { getActorContext } from '../../../utils/access/actorContext'
import { canBool } from '../../../utils/access/can'

/**
 * PATCH /api/question-bank/questions/:id — правка ЧЕРНОВИКА.
 * Правила:
 *  - опубликованный вопрос иммутабелен → 409 (правка = новая версия отдельно);
 *  - member (create_draft без edit_draft на чужое) правит только СВОЙ черновик (ABAC).
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { questionBank: ['create_draft'] })
  const orgId = session.session.activeOrganizationId
  const { id } = await getValidatedRouterParams(event, bankQuestionIdParamSchema.parse)
  const body = await readValidatedBody(event, updateBankQuestionSchema.parse)

  const existing = await db.query.bankQuestion.findFirst({
    where: and(eq(bankQuestion.id, id), eq(bankQuestion.organizationId, orgId)),
    columns: { id: true, status: true, createdById: true },
  })
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Вопрос не найден' })

  if (existing.status !== 'draft') {
    throw createError({ statusCode: 409, statusMessage: 'Опубликованный/архивный вопрос нельзя править. Создайте новую версию.' })
  }

  // ABAC: править чужой черновик может только тот, у кого есть edit_draft.
  const isOwner = existing.createdById === session.user.id
  if (!isOwner) {
    const actor = await getActorContext(event)
    if (!canBool(actor, 'questionBank:edit_draft')) {
      throw createError({ statusCode: 403, statusMessage: 'Нет прав на правку чужого черновика' })
    }
  }

  const patch: Record<string, unknown> = { updatedAt: new Date() }
  for (const k of ['primaryTopicId', 'type', 'text', 'goal', 'assesses', 'recommendedStage',
    'expectedSignal', 'strongIndicators', 'weakIndicators', 'durationMin', 'complexity',
    'secondaryTopicIds', 'scaleIdOverride', 'targetRoles', 'tags'] as const) {
    if (body[k] !== undefined) patch[k] = body[k]
  }

  const [updated] = await db.update(bankQuestion)
    .set(patch)
    .where(and(eq(bankQuestion.id, id), eq(bankQuestion.organizationId, orgId)))
    .returning()
  return updated
})
