import { assessmentTopic } from '../../../database/schema'
import { createTopicSchema } from '../../../utils/schemas/bankQuestion'
import { nextEntityCode } from '../../../utils/questions/generateCode'

/**
 * POST /api/question-bank/topics
 * Создать тему оценки. Право manage_topics (owner/admin).
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { questionBank: ['manage_topics'] })
  const orgId = session.session.activeOrganizationId
  const body = await readValidatedBody(event, createTopicSchema.parse)

  const created = await db.transaction(async (tx) => {
    const code = await nextEntityCode(tx, 'assessment_topic', orgId)
    const [row] = await tx.insert(assessmentTopic).values({
      organizationId: orgId,
      code,
      name: body.name,
      shortName: body.shortName ?? null,
      type: body.type,
      definition: body.definition ?? null,
      goal: body.goal ?? null,
      positiveIndicators: body.positiveIndicators,
      negativeIndicators: body.negativeIndicators,
      parentTopicId: body.parentTopicId ?? null,
      targetRoles: body.targetRoles,
      tags: body.tags,
      displayOrder: body.displayOrder,
      createdById: session.user.id,
    }).returning()
    return row
  })

  setResponseStatus(event, 201)
  return created
})
