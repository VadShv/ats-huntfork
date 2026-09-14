import { and, eq } from 'drizzle-orm'
import { requireJobInScope } from '../../../../utils/access/scope'
import { jobInterviewQuestion, scoringCriterion, bankQuestion } from '../../../../database/schema'
import { jobIdParamSchema } from '../../../../utils/schemas/interviewQuestion'

/**
 * GET /api/jobs/:id/interview-questions/coverage-matrix
 * Матрица покрытия критерий×вопрос + дыры (критерии без вопросов) +
 * список доступных обновлений org-версии. job:['read'].
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { job: ['read'] })
  const orgId = session.session.activeOrganizationId
  const { id: jobId } = await getValidatedRouterParams(event, jobIdParamSchema.parse)
  await requireJobInScope(event, jobId as string)

  const criteria = await db.query.scoringCriterion.findMany({
    where: eq(scoringCriterion.jobId, jobId),
    columns: { id: true, key: true, name: true, weight: true },
  })

  const questions = await db.query.jobInterviewQuestion.findMany({
    where: and(eq(jobInterviewQuestion.jobId, jobId), eq(jobInterviewQuestion.organizationId, orgId), eq(jobInterviewQuestion.isArchived, false)),
    columns: {
      id: true, text: true, criterionId: true, linkMode: true,
      sourceBankQuestionId: true, sourceVersion: true, overriddenFields: true,
    },
  })

  // Покрытие: критерий → сколько вопросов.
  const byCriterion = new Map<string, number>()
  for (const q of questions) {
    if (q.criterionId) byCriterion.set(q.criterionId, (byCriterion.get(q.criterionId) ?? 0) + 1)
  }
  const coverage = criteria.map(c => ({
    criterionId: c.id,
    key: c.key,
    name: c.name,
    weight: c.weight,
    questionCount: byCriterion.get(c.id) ?? 0,
    covered: (byCriterion.get(c.id) ?? 0) > 0,
  }))
  const gaps = coverage.filter(c => !c.covered)
  const uncategorized = questions.filter(q => !q.criterionId).length

  // Доступные обновления org-версии (детерминированно).
  const linkedIds = questions
    .filter(q => (q.linkMode === 'linked' || q.linkMode === 'linked_with_overrides') && q.sourceBankQuestionId)
    .map(q => q.sourceBankQuestionId!) as string[]
  const updates: { questionId: string, sourceBankQuestionId: string, fromVersion: number | null, toVersion: number }[] = []
  if (linkedIds.length) {
    const sources = await db.query.bankQuestion.findMany({
      where: and(eq(bankQuestion.organizationId, orgId)),
      columns: { id: true, version: true },
    })
    const versionById = new Map<string, number>(sources.map(s => [s.id, s.version as number]))
    for (const q of questions) {
      if (!q.sourceBankQuestionId) continue
      const cur = versionById.get(q.sourceBankQuestionId)
      const sv = q.sourceVersion as number | null
      if (cur != null && sv != null && cur > sv) {
        updates.push({ questionId: q.id, sourceBankQuestionId: q.sourceBankQuestionId, fromVersion: sv, toVersion: cur })
      }
    }
  }

  return {
    coverage,
    gaps,
    uncategorizedQuestions: uncategorized,
    totalQuestions: questions.length,
    hasCriteria: criteria.length > 0,
    updatesAvailable: updates,
  }
})
