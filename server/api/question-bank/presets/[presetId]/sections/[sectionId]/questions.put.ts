import { and, eq } from 'drizzle-orm'
import { presetSection, presetSectionQuestion, bankQuestion, questionPreset } from '../../../../../../database/schema'
import { sectionIdParamSchema, setSectionQuestionsSchema } from '../../../../../../utils/schemas/preset'
import { inArray } from 'drizzle-orm'

/**
 * PUT /api/question-bank/presets/:presetId/sections/:sectionId/questions
 * Заменить набор вопросов раздела (bulk). Только published-вопросы банка. create_draft.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { questionBank: ['create_draft'] })
  const orgId = session.session.activeOrganizationId
  const { presetId, sectionId } = await getValidatedRouterParams(event, sectionIdParamSchema.parse)
  const body = await readValidatedBody(event, setSectionQuestionsSchema.parse)

  const preset = await db.query.questionPreset.findFirst({
    where: and(eq(questionPreset.id, presetId), eq(questionPreset.organizationId, orgId)),
    columns: { status: true },
  })
  if (!preset) throw createError({ statusCode: 404, statusMessage: 'Пресет не найден' })
  if (preset.status === 'published') throw createError({ statusCode: 409, statusMessage: 'Опубликованный пресет нельзя править' })

  const section = await db.query.presetSection.findFirst({
    where: and(eq(presetSection.id, sectionId), eq(presetSection.presetId, presetId), eq(presetSection.organizationId, orgId)),
    columns: { id: true },
  })
  if (!section) throw createError({ statusCode: 404, statusMessage: 'Раздел не найден' })

  // Проверить, что все вопросы published и принадлежат орг.
  if (body.questions.length) {
    const ids = body.questions.map(q => q.bankQuestionId)
    const found = await db.query.bankQuestion.findMany({
      where: and(eq(bankQuestion.organizationId, orgId), inArray(bankQuestion.id, ids)),
      columns: { id: true, status: true },
    })
    const okIds = new Set(found.filter(f => f.status === 'published').map(f => f.id))
    const bad = ids.filter(id => !okIds.has(id))
    if (bad.length) throw createError({ statusCode: 422, statusMessage: 'Некоторые вопросы не опубликованы или не найдены' })
  }

  const rows = await db.transaction(async (tx) => {
    await tx.delete(presetSectionQuestion)
      .where(and(eq(presetSectionQuestion.sectionId, sectionId), eq(presetSectionQuestion.organizationId, orgId)))
    if (!body.questions.length) return []
    return tx.insert(presetSectionQuestion).values(
      body.questions.map((q, i) => ({
        organizationId: orgId,
        sectionId,
        bankQuestionId: q.bankQuestionId,
        isRequired: q.isRequired,
        displayOrder: q.displayOrder ?? i,
      })),
    ).returning()
  })

  return { items: rows }
})
