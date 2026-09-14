import { and, eq } from 'drizzle-orm'
import { questionPreset, presetSection, assessmentTopic } from '../../../../database/schema'
import { presetIdParamSchema, createSectionSchema } from '../../../../utils/schemas/preset'

/** POST /api/question-bank/presets/:presetId/sections — добавить раздел. create_draft. */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { questionBank: ['create_draft'] })
  const orgId = session.session.activeOrganizationId
  const { presetId } = await getValidatedRouterParams(event, presetIdParamSchema.parse)
  const body = await readValidatedBody(event, createSectionSchema.parse)

  const preset = await db.query.questionPreset.findFirst({
    where: and(eq(questionPreset.id, presetId), eq(questionPreset.organizationId, orgId)),
    columns: { id: true, status: true },
  })
  if (!preset) throw createError({ statusCode: 404, statusMessage: 'Пресет не найден' })
  if (preset.status === 'published') throw createError({ statusCode: 409, statusMessage: 'Опубликованный пресет нельзя править' })

  const topic = await db.query.assessmentTopic.findFirst({
    where: and(eq(assessmentTopic.id, body.topicId), eq(assessmentTopic.organizationId, orgId)),
    columns: { id: true },
  })
  if (!topic) throw createError({ statusCode: 422, statusMessage: 'Тема не найдена в организации' })

  const [created] = await db.insert(presetSection).values({
    organizationId: orgId,
    presetId,
    topicId: body.topicId,
    title: body.title,
    goal: body.goal ?? null,
    weight: body.weight,
    minQuestions: body.minQuestions,
    maxQuestions: body.maxQuestions,
    displayOrder: body.displayOrder,
  }).returning()

  setResponseStatus(event, 201)
  return created
})
