import { and, eq, asc, isNull } from 'drizzle-orm'
import { requireApplicationInScope } from '../../../../utils/access/scope'
import {
  application, applicationQuestionSet, applicationQuestionItem,
  candidateResumeVersion, resumeRisk, carePrompt, careMethodology,
} from '../../../../database/schema'
import { applicationIdParamSchema } from '../../../../utils/schemas/candidateQuestions'
import { personalizeQuestionnaire, type ScaffoldItem } from '../../../../utils/ai/personalizeQuestionnaire'
import type { SupportedProvider } from '../../../../utils/ai/provider'
import { loadAiConfig } from '../../../../utils/ai/loadConfig'
import { createRateLimiter } from '../../../../utils/rateLimit'

const limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 10, message: 'Слишком много запросов персонализации. Повторите позже' })

/**
 * POST /api/applications/:id/question-set/personalize
 * LLM-персонализация каркаса опросника под кандидата. Опциональный проход,
 * graceful degradation при отказе LLM. Snapshot иммутабелен (409). application:['update'].
 */
export default defineEventHandler(async (event) => {
  await limiter(event)
  const session = await requirePermission(event, { application: ['update'] })
  const orgId = session.session.activeOrganizationId
  const { id: applicationId } = await getValidatedRouterParams(event, applicationIdParamSchema.parse)
  await requireApplicationInScope(event, applicationId as string, orgId)

  const app = await db.query.application.findFirst({
    where: and(eq(application.id, applicationId), eq(application.organizationId, orgId)),
    columns: { id: true, jobId: true, candidateId: true },
  })
  if (!app) throw createError({ statusCode: 404, statusMessage: 'Отклик не найден' })

  const set = await db.query.applicationQuestionSet.findFirst({
    where: and(eq(applicationQuestionSet.applicationId, applicationId), eq(applicationQuestionSet.organizationId, orgId), eq(applicationQuestionSet.isSnapshot, false)),
    columns: { id: true },
  })
  if (!set) throw createError({ statusCode: 404, statusMessage: 'Опросник не сгенерирован' })

  // Только основные вопросы (без probe) каркаса.
  const items = await db.query.applicationQuestionItem.findMany({
    where: and(eq(applicationQuestionItem.setId, set.id), eq(applicationQuestionItem.organizationId, orgId), isNull(applicationQuestionItem.parentItemId)),
    orderBy: [asc(applicationQuestionItem.displayOrder)],
  })
  if (!items.length) throw createError({ statusCode: 422, statusMessage: 'Нет вопросов для персонализации' })

  const scaffold: ScaffoldItem[] = items.map(i => ({
    text: i.text, origin: i.origin, listenFor: i.listenFor, isRisk: i.origin === 'risk_derived',
  }))

  // Контекст кандидата.
  const version = await db.query.candidateResumeVersion.findFirst({
    where: and(eq(candidateResumeVersion.candidateId, app.candidateId), eq(candidateResumeVersion.isCurrent, true)),
    columns: { id: true },
  })
  let riskSummary = ''
  if (version) {
    const risk = await db.query.resumeRisk.findFirst({
      where: and(eq(resumeRisk.resumeVersionId, version.id), eq(resumeRisk.organizationId, orgId)),
      columns: { summary: true },
    })
    riskSummary = risk?.summary ?? ''
  }

  // Методика CARE + активный промпт персонализации.
  const methodology = await db.query.careMethodology.findFirst({
    where: and(eq(careMethodology.organizationId, orgId), eq(careMethodology.isActive, true)),
    columns: { interviewerInstruction: true },
  })
  const prompt = await db.query.carePrompt.findFirst({
    where: and(eq(carePrompt.organizationId, orgId), eq(carePrompt.kind, 'personalize_questionnaire'), eq(carePrompt.isActive, true)),
    columns: { promptText: true },
  })

  const config = await loadAiConfig(orgId, { purpose: 'structuring' })

  let personalized
  try {
    personalized = await personalizeQuestionnaire(
      {
        provider: config.provider as SupportedProvider,
        model: config.model,
        apiKeyEncrypted: config.apiKeyEncrypted,
        baseUrl: config.baseUrl,
        maxTokens: config.maxTokens,
      },
      {
        candidateContext: { riskSummary },
        scaffold,
        careInstruction: methodology?.interviewerInstruction ?? undefined,
        carePromptText: prompt?.promptText,
      },
    )
  }
  catch {
    setResponseStatus(event, 200)
    return { personalized: false, message: 'Персонализация недоступна, показан базовый опросник' }
  }

  // Применить: обновить основные вопросы + добавить probe (дочерние items).
  const saved = await db.transaction(async (tx) => {
    let probeCount = 0
    for (const p of personalized) {
      const parent = items[p.index]
      if (!parent) continue
      await tx.update(applicationQuestionItem)
        .set({
          originalText: parent.originalText ?? parent.text,
          text: p.text || parent.text,
          expectedEvidence: p.expectedEvidence,
          greenFlags: p.greenFlags,
          redFlags: p.redFlags,
          isPersonalized: true,
          updatedAt: new Date(),
        })
        .where(eq(applicationQuestionItem.id, parent.id))

      // Заменить прежние probe этого вопроса.
      await tx.delete(applicationQuestionItem)
        .where(and(eq(applicationQuestionItem.parentItemId, parent.id), eq(applicationQuestionItem.organizationId, orgId)))
      let po = 0
      for (const probe of p.careProbes) {
        await tx.insert(applicationQuestionItem).values({
          organizationId: orgId,
          setId: set.id,
          parentItemId: parent.id,
          careElement: probe.careElement,
          text: probe.text,
          listenFor: probe.sufficientSignal || null,
          category: parent.category,
          origin: 'personalized',
          priority: parent.priority,
          displayOrder: po++,
        })
        probeCount++
      }
    }
    await tx.update(applicationQuestionSet)
      .set({ personalizedAt: new Date(), personalizeModel: `${config.provider}/${config.model}` })
      .where(eq(applicationQuestionSet.id, set.id))
    return { probeCount }
  })

  return { personalized: true, items: personalized.length, probes: saved.probeCount }
})
