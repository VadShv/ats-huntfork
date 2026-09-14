import { and, eq, desc } from 'drizzle-orm'
import { requireJobInScope } from '../../../../utils/access/scope'
import {
  questionPreset, presetSection, jobInterviewQuestion, scoringCriterion, jobQuestionnaireMeta,
} from '../../../../database/schema'
import { jobIdParamSchema } from '../../../../utils/schemas/interviewQuestion'
import { importPresetSchema } from '../../../../utils/schemas/preset'
import { buildImportRows, type PresetSectionForImport } from '../../../../utils/questions/importPreset'
import { normalizeQuestion } from '../../../../utils/text/normalizeQuestion'

/**
 * POST /api/jobs/:id/interview-questions/import-preset
 * Детерминированный импорт опубликованного пресета в карту вакансии (0 LLM).
 * job:['update'].
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { job: ['update'] })
  const orgId = session.session.activeOrganizationId
  const { id: jobId } = await getValidatedRouterParams(event, jobIdParamSchema.parse)
  await requireJobInScope(event, jobId as string)
  const body = await readValidatedBody(event, importPresetSchema.parse)

  const preset = await db.query.questionPreset.findFirst({
    where: and(eq(questionPreset.id, body.presetId), eq(questionPreset.organizationId, orgId)),
    with: {
      sections: {
        with: {
          topic: { columns: { id: true, type: true, name: true, code: true } },
          questions: { with: { bankQuestion: { columns: { id: true, version: true, text: true, goal: true, expectedSignal: true, status: true } } } },
        },
      },
    },
  })
  if (!preset) throw createError({ statusCode: 404, statusMessage: 'Пресет не найден' })
  if (preset.status !== 'published') throw createError({ statusCode: 422, statusMessage: 'Импортировать можно только опубликованный пресет' })

  // Критерии вакансии для авто-матча.
  const criteria = await db.query.scoringCriterion.findMany({
    where: eq(scoringCriterion.jobId, jobId),
    columns: { id: true, key: true, name: true },
  })

  // Существующие вопросы карты (дедуп + max order).
  const existing = await db.query.jobInterviewQuestion.findMany({
    where: and(eq(jobInterviewQuestion.jobId, jobId), eq(jobInterviewQuestion.organizationId, orgId)),
    columns: { id: true, text: true, displayOrder: true, presetId: true, source: true, overriddenFields: true, isArchived: true },
  })
  const existingNormalized = new Set<string>(existing.filter(e => !e.isArchived).map(e => normalizeQuestion(e.text)))
  const maxOrder = existing.reduce((m, e) => Math.max(m, e.displayOrder), -1)

  const sections: PresetSectionForImport[] = preset.sections.map(s => ({
    id: s.id,
    topicId: s.topicId,
    topicType: (s.topic?.type ?? 'custom') as PresetSectionForImport['topicType'],
    topicName: s.topic?.name ?? null,
    topicCode: s.topic?.code ?? null,
    goal: s.goal,
    displayOrder: s.displayOrder,
    questions: s.questions.map(q => ({
      bankQuestion: {
        id: q.bankQuestion.id,
        version: q.bankQuestion.version,
        text: q.bankQuestion.text,
        goal: q.bankQuestion.goal,
        expectedSignal: q.bankQuestion.expectedSignal,
        status: q.bankQuestion.status,
      },
      isRequired: q.isRequired,
      displayOrder: q.displayOrder,
    })),
  }))

  const { rows, skippedDuplicates } = buildImportRows({
    presetId: preset.id,
    sections,
    criteria,
    existingNormalized,
    startOrder: maxOrder + 1,
  })

  const result = await db.transaction(async (tx) => {
    // replace: архивируем ранее импортированные из пресета без локальных правок.
    if (body.replace) {
      for (const e of existing) {
        if (e.presetId && e.source !== 'manual' && Array.isArray(e.overriddenFields) && e.overriddenFields.length === 0 && !e.isArchived) {
          await tx.update(jobInterviewQuestion)
            .set({ isArchived: true, updatedAt: new Date() })
            .where(eq(jobInterviewQuestion.id, e.id))
        }
      }
    }

    let inserted: typeof jobInterviewQuestion.$inferSelect[] = []
    if (rows.length) {
      inserted = await tx.insert(jobInterviewQuestion).values(
        rows.map(r => ({
          organizationId: orgId,
          jobId,
          text: r.text,
          category: r.category,
          rationale: r.rationale,
          goodAnswer: r.goodAnswer,
          source: 'manual' as const,
          linkMode: r.linkMode,
          sourceBankQuestionId: r.sourceBankQuestionId,
          sourceVersion: r.sourceVersion,
          presetId: r.presetId,
          sectionRef: r.sectionRef,
          criterionId: r.criterionId,
          displayOrder: r.displayOrder,
          createdById: session.user.id,
        })),
      ).returning()
    }

    // Upsert провенанса карты.
    const [latestVer] = await tx.select({ version: questionPreset.version })
      .from(questionPreset).where(eq(questionPreset.id, preset.id)).limit(1)
    await tx.insert(jobQuestionnaireMeta).values({
      organizationId: orgId,
      jobId,
      presetId: preset.id,
      presetVersion: latestVer?.version ?? preset.version,
      importedAt: new Date(),
      importedById: session.user.id,
    }).onConflictDoUpdate({
      target: jobQuestionnaireMeta.jobId,
      set: {
        presetId: preset.id,
        presetVersion: latestVer?.version ?? preset.version,
        importedAt: new Date(),
        importedById: session.user.id,
        updatedAt: new Date(),
      },
    })

    return inserted
  })

  return { inserted: result.length, skippedDuplicates, adapted: false }
})
