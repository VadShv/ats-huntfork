import { and, eq, inArray } from 'drizzle-orm'
import { requireJobInScope } from '../../../../utils/access/scope'
import { jobInterviewQuestion, bankQuestion, assessmentTopic, scoringCriterion } from '../../../../database/schema'
import { jobIdParamSchema } from '../../../../utils/schemas/interviewQuestion'
import { addFromBankSchema } from '../../../../utils/schemas/preset'
import { topicTypeToCategory, type TopicType } from '../../../../utils/questions/importPreset'
import { normalizeQuestion } from '../../../../utils/text/normalizeQuestion'

/**
 * POST /api/jobs/:id/interview-questions/add-from-bank
 * Добавить в карту вакансии конкретные вопросы банка (linked). job:['update'].
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { job: ['update'] })
  const orgId = session.session.activeOrganizationId
  const { id: jobId } = await getValidatedRouterParams(event, jobIdParamSchema.parse)
  await requireJobInScope(event, jobId as string)
  const body = await readValidatedBody(event, addFromBankSchema.parse)

  const questions = await db.query.bankQuestion.findMany({
    where: and(eq(bankQuestion.organizationId, orgId), inArray(bankQuestion.id, body.bankQuestionIds)),
    with: { primaryTopic: { columns: { type: true } } },
  })
  const published = questions.filter(q => q.status === 'published')
  if (!published.length) throw createError({ statusCode: 422, statusMessage: 'Нет опубликованных вопросов для добавления' })

  if (body.criterionId) {
    const crit = await db.query.scoringCriterion.findFirst({
      where: and(eq(scoringCriterion.id, body.criterionId), eq(scoringCriterion.jobId, jobId)),
      columns: { id: true },
    })
    if (!crit) throw createError({ statusCode: 422, statusMessage: 'Критерий не принадлежит вакансии' })
  }

  const existing = await db.query.jobInterviewQuestion.findMany({
    where: and(eq(jobInterviewQuestion.jobId, jobId), eq(jobInterviewQuestion.organizationId, orgId), eq(jobInterviewQuestion.isArchived, false)),
    columns: { text: true, displayOrder: true },
  })
  const seen = new Set(existing.map(e => normalizeQuestion(e.text)))
  let order = existing.reduce((m, e) => Math.max(m, e.displayOrder), -1) + 1

  const rows = []
  let skipped = 0
  for (const bq of published) {
    const norm = normalizeQuestion(bq.text)
    if (seen.has(norm)) { skipped++; continue }
    seen.add(norm)
    rows.push({
      organizationId: orgId,
      jobId,
      text: bq.text,
      category: topicTypeToCategory((bq.primaryTopic?.type ?? 'custom') as TopicType),
      rationale: bq.goal ?? null,
      goodAnswer: bq.expectedSignal ?? null,
      source: 'manual' as const,
      linkMode: 'linked' as const,
      sourceBankQuestionId: bq.id,
      sourceVersion: bq.version,
      criterionId: body.criterionId ?? null,
      displayOrder: order++,
      createdById: session.user.id,
    })
  }

  if (!rows.length) return { inserted: 0, skippedDuplicates: skipped }
  const inserted = await db.insert(jobInterviewQuestion).values(rows).returning()
  return { inserted: inserted.length, skippedDuplicates: skipped }
})
