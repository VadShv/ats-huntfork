import { and, eq } from 'drizzle-orm'
import { assessmentTopic, bankQuestion } from '../../../database/schema'
import { createBankQuestionSchema } from '../../../utils/schemas/bankQuestion'
import { nextEntityCode } from '../../../utils/questions/generateCode'

/**
 * POST /api/question-bank/questions
 * Создать черновик вопроса банка (status=draft, source=manual). create_draft.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { questionBank: ['create_draft'] })
  const orgId = session.session.activeOrganizationId
  const body = await readValidatedBody(event, createBankQuestionSchema.parse)

  // Тема должна принадлежать организации.
  const topic = await db.query.assessmentTopic.findFirst({
    where: and(eq(assessmentTopic.id, body.primaryTopicId), eq(assessmentTopic.organizationId, orgId)),
    columns: { id: true },
  })
  if (!topic) throw createError({ statusCode: 422, statusMessage: 'Тема не найдена в организации' })

  const created = await db.transaction(async (tx) => {
    const code = await nextEntityCode(tx, 'bank_question', orgId)
    const [row] = await tx.insert(bankQuestion).values({
      organizationId: orgId,
      code,
      primaryTopicId: body.primaryTopicId,
      type: body.type,
      text: body.text,
      goal: body.goal ?? null,
      assesses: body.assesses ?? null,
      recommendedStage: body.recommendedStage ?? null,
      expectedSignal: body.expectedSignal ?? null,
      strongIndicators: body.strongIndicators,
      weakIndicators: body.weakIndicators,
      durationMin: body.durationMin ?? null,
      complexity: body.complexity ?? null,
      secondaryTopicIds: body.secondaryTopicIds,
      scaleIdOverride: body.scaleIdOverride ?? null,
      targetRoles: body.targetRoles,
      tags: body.tags,
      status: 'draft',
      source: 'manual',
      ownerId: session.user.id,
      createdById: session.user.id,
    }).returning()
    return row
  })

  setResponseStatus(event, 201)
  return created
})
