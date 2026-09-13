import { and, eq, asc, desc } from 'drizzle-orm'
import { requireApplicationInScope } from '../../../../utils/access/scope'
import {
  application, applicationQuestionSet, applicationQuestionItem,
  jobInterviewQuestion, candidateResumeVersion, resumeRisk,
} from '../../../../database/schema'
import { applicationIdParamSchema, generateSetSchema } from '../../../../utils/schemas/candidateQuestions'
import { assembleCandidateQuestions, type RiskFindingLite } from '../../../../utils/risk/buildCandidateQuestions'

/**
 * POST /api/applications/:id/question-set/generate
 *
 * Deterministically (NO LLM) assembles a per-candidate question set from the job's
 * interview-question bank (Stage 2) + risk findings of the candidate's current
 * resume version (Stage 3, findings[].question). Regeneration preserves manual items
 * and any filled answerNote/askStatus.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { application: ['update'] })
  const orgId = session.session.activeOrganizationId

  const { id: applicationId } = await getValidatedRouterParams(event, applicationIdParamSchema.parse)
  await requireApplicationInScope(event, applicationId as string, orgId)
  const body = await readValidatedBody(event, generateSetSchema.parse)

  const app = await db.query.application.findFirst({
    where: and(eq(application.id, applicationId), eq(application.organizationId, orgId)),
    columns: { id: true, jobId: true, candidateId: true },
  })
  if (!app) throw createError({ statusCode: 404, statusMessage: 'Отклик не найден' })

  // Bank questions for the job (non-archived).
  const bank = await db.query.jobInterviewQuestion.findMany({
    where: and(
      eq(jobInterviewQuestion.jobId, app.jobId),
      eq(jobInterviewQuestion.organizationId, orgId),
      eq(jobInterviewQuestion.isArchived, false),
    ),
    orderBy: [asc(jobInterviewQuestion.displayOrder), asc(jobInterviewQuestion.createdAt)],
    columns: { id: true, text: true, category: true, rationale: true },
  })

  // Risk findings of the candidate's current resume version.
  const current = await db.query.candidateResumeVersion.findFirst({
    where: and(eq(candidateResumeVersion.candidateId, app.candidateId), eq(candidateResumeVersion.isCurrent, true)),
    columns: { id: true },
  })
  const version = current ?? await db.query.candidateResumeVersion.findFirst({
    where: eq(candidateResumeVersion.candidateId, app.candidateId),
    orderBy: [desc(candidateResumeVersion.versionNumber)],
    columns: { id: true },
  })

  let findings: RiskFindingLite[] = []
  let basedOnResumeRiskId: string | null = null
  if (version) {
    const risk = await db.query.resumeRisk.findFirst({
      where: and(eq(resumeRisk.resumeVersionId, version.id), eq(resumeRisk.organizationId, orgId)),
      columns: { id: true, findingsJson: true, status: true },
    })
    if (risk && risk.status === 'completed') {
      basedOnResumeRiskId = risk.id
      const fj = risk.findingsJson as { findings?: RiskFindingLite[] } | null
      findings = Array.isArray(fj?.findings) ? fj!.findings! : []
    }
  }

  const assembled = assembleCandidateQuestions({
    bank: bank.map(b => ({ id: b.id, text: b.text, category: b.category, rationale: b.rationale })),
    findings,
    perBankCategory: body.perBankCategory,
  })

  // Upsert the set; preserve manual items + filled answers on regenerate.
  const now = new Date()
  const result = await db.transaction(async (tx) => {
    let set = await tx.query.applicationQuestionSet.findFirst({
      where: and(eq(applicationQuestionSet.applicationId, applicationId), eq(applicationQuestionSet.organizationId, orgId)),
      columns: { id: true },
    })
    if (set) {
      await tx.update(applicationQuestionSet)
        .set({ basedOnResumeRiskId, generatedAt: now, createdById: session.user.id })
        .where(eq(applicationQuestionSet.id, set.id))
    }
    else {
      const [created] = await tx.insert(applicationQuestionSet)
        .values({ organizationId: orgId, applicationId, basedOnResumeRiskId, createdById: session.user.id })
        .returning({ id: applicationQuestionSet.id })
      set = created!
    }

    // Preserve manual items and any items with a filled answer/ask status.
    const kept = await tx.query.applicationQuestionItem.findMany({
      where: and(eq(applicationQuestionItem.setId, set.id), eq(applicationQuestionItem.organizationId, orgId)),
    })
    const keepIds = new Set(
      kept.filter(i => i.origin === 'manual' || (i.answerNote && i.answerNote.trim() !== '') || i.askStatus !== 'pending').map(i => i.id),
    )
    // Delete only regenerable (non-kept) items.
    for (const i of kept) {
      if (!keepIds.has(i.id)) {
        await tx.delete(applicationQuestionItem).where(eq(applicationQuestionItem.id, i.id))
      }
    }

    // Existing texts (kept) → avoid duplicates when inserting fresh ones.
    const keptNorm = new Set(kept.filter(i => keepIds.has(i.id)).map(i => i.text.toLowerCase().replace(/\s+/g, ' ').trim()))
    let order = kept.filter(i => keepIds.has(i.id)).length
    const rows = assembled
      .filter(a => !keptNorm.has(a.text.toLowerCase().replace(/\s+/g, ' ').trim()))
      .map(a => ({
        organizationId: orgId,
        setId: set!.id,
        text: a.text,
        listenFor: a.listenFor,
        category: a.category,
        origin: a.origin,
        sourceRef: a.sourceRef,
        rationale: a.rationale,
        displayOrder: order++,
      }))
    if (rows.length) await tx.insert(applicationQuestionItem).values(rows)

    return { setId: set.id, inserted: rows.length }
  })

  return {
    applicationId,
    setId: result.setId,
    insertedCount: result.inserted,
    basedOnResumeRiskId,
    riskAvailable: findings.length > 0,
  }
})
