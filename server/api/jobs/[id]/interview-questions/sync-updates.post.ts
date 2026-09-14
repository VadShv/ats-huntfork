import { and, eq } from 'drizzle-orm'
import { requireJobInScope } from '../../../../utils/access/scope'
import { jobInterviewQuestion, bankQuestion } from '../../../../database/schema'
import { jobIdParamSchema } from '../../../../utils/schemas/interviewQuestion'
import { syncUpdatesSchema } from '../../../../utils/schemas/preset'

/**
 * POST /api/jobs/:id/interview-questions/sync-updates
 * Синхронизация с org-версией БЕЗ молчаливой перезаписи: обновляем только явно
 * принятые поля; keepLocal лишь поднимает sourceVersion. job:['update'].
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { job: ['update'] })
  const orgId = session.session.activeOrganizationId
  const { id: jobId } = await getValidatedRouterParams(event, jobIdParamSchema.parse)
  await requireJobInScope(event, jobId as string)
  const body = await readValidatedBody(event, syncUpdatesSchema.parse)

  const fieldToBank: Record<string, 'text' | 'goal' | 'expectedSignal' | null> = {
    text: 'text', rationale: 'goal', goodAnswer: 'expectedSignal', category: null,
  }

  const result = await db.transaction(async (tx) => {
    let accepted = 0
    let kept = 0

    for (const item of body.accept) {
      const q = await tx.query.jobInterviewQuestion.findFirst({
        where: and(eq(jobInterviewQuestion.id, item.questionId), eq(jobInterviewQuestion.jobId, jobId), eq(jobInterviewQuestion.organizationId, orgId)),
      })
      if (!q || !q.sourceBankQuestionId) continue
      const src = await tx.query.bankQuestion.findFirst({
        where: and(eq(bankQuestion.id, q.sourceBankQuestionId), eq(bankQuestion.organizationId, orgId)),
      })
      if (!src) continue

      const patch: Record<string, unknown> = { updatedAt: new Date() }
      const overrides = new Set((q.overriddenFields as string[]) ?? [])
      for (const f of item.fields) {
        const bankField = fieldToBank[f]
        if (f === 'text') patch.text = src.text
        else if (f === 'rationale') patch.rationale = src.goal
        else if (f === 'goodAnswer') patch.goodAnswer = src.expectedSignal
        // category не маппится напрямую — пропускаем (нет источника в bank напрямую)
        if (bankField !== null || f === 'text') overrides.delete(f)
      }
      const newOverrides = [...overrides]
      patch.overriddenFields = newOverrides
      patch.sourceVersion = src.version
      patch.linkMode = newOverrides.length === 0 ? 'linked' : 'linked_with_overrides'

      await tx.update(jobInterviewQuestion)
        .set(patch)
        .where(eq(jobInterviewQuestion.id, item.questionId))
      accepted++
    }

    for (const item of body.keepLocal) {
      const q = await tx.query.jobInterviewQuestion.findFirst({
        where: and(eq(jobInterviewQuestion.id, item.questionId), eq(jobInterviewQuestion.jobId, jobId), eq(jobInterviewQuestion.organizationId, orgId)),
        columns: { id: true, sourceBankQuestionId: true },
      })
      if (!q || !q.sourceBankQuestionId) continue
      const src = await tx.query.bankQuestion.findFirst({
        where: eq(bankQuestion.id, q.sourceBankQuestionId), columns: { version: true },
      })
      if (!src) continue
      await tx.update(jobInterviewQuestion)
        .set({ sourceVersion: src.version, updatedAt: new Date() })
        .where(eq(jobInterviewQuestion.id, item.questionId))
      kept++
    }

    return { accepted, kept }
  })

  return result
})
