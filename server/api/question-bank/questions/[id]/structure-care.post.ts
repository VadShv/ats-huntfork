import { and, eq } from 'drizzle-orm'
import { bankQuestion, bankQuestionProbe, assessmentScale, carePrompt } from '../../../../database/schema'
import { bankQuestionIdParamSchema } from '../../../../utils/schemas/bankQuestion'
import { structureCareSchema } from '../../../../utils/schemas/care'
import { structureQuestionCare, DEFAULT_STRUCTURE_CARE_PROMPT } from '../../../../utils/ai/structureQuestionCare'
import type { SupportedProvider } from '../../../../utils/ai/provider'
import { loadAiConfig } from '../../../../utils/ai/loadConfig'
import { ensureCareMethodology } from '../../../../utils/questions/seedCareMethodology'
import { createRateLimiter } from '../../../../utils/rateLimit'

const limiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 10,
  message: 'Слишком много запросов на разложение по CARE. Повторите позже',
})

interface ProbeRule { trigger: string, recommendedProbe: string, careElement?: string }

/** Подстановка {{name}} → value. */
function substitute(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '')
}

/**
 * POST /api/question-bank/questions/:id/structure-care
 * AI-разложение вопроса банка по CARE. manage_care + rate-limit.
 */
export default defineEventHandler(async (event) => {
  await limiter(event)
  const session = await requirePermission(event, { questionBank: ['manage_care'] })
  const orgId = session.session.activeOrganizationId
  const { id } = await getValidatedRouterParams(event, bankQuestionIdParamSchema.parse)
  const body = await readValidatedBody(event, structureCareSchema.parse)

  const q = await db.query.bankQuestion.findFirst({
    where: and(eq(bankQuestion.id, id), eq(bankQuestion.organizationId, orgId)),
    with: { primaryTopic: true },
  })
  if (!q) throw createError({ statusCode: 404, statusMessage: 'Вопрос не найден' })

  const methodology = await ensureCareMethodology(orgId, session.user.id)
  const prompt = await db.query.carePrompt.findFirst({
    where: and(eq(carePrompt.organizationId, orgId), eq(carePrompt.kind, 'structure_question'), eq(carePrompt.isActive, true)),
  })

  // Резолв темы/цели/шкалы.
  const topicName = q.primaryTopic?.name ?? ''
  const topicDef = q.primaryTopic?.definition ? ` — ${q.primaryTopic.definition}` : ''
  const topic = `${topicName}${topicDef}`
  const goal = q.goal || q.primaryTopic?.goal || ''

  let scaleType = body.scaleType ?? 'numeric_5'
  if (q.scaleIdOverride) {
    const s = await db.query.assessmentScale.findFirst({ where: eq(assessmentScale.id, q.scaleIdOverride), columns: { type: true } })
    if (s) scaleType = s.type
  }
  else if (q.primaryTopicId) {
    const defScale = await db.query.assessmentScale.findFirst({
      where: and(eq(assessmentScale.topicId, q.primaryTopicId), eq(assessmentScale.isDefault, true)),
      columns: { type: true },
    })
    if (defScale) scaleType = defScale.type
  }

  // Рендер probe_rules из snapshot методики.
  const probeRules = (methodology.probeRules as ProbeRule[] | null) ?? []
  const probeRulesText = probeRules.map(r => `— ${r.trigger} → ${r.recommendedProbe}`).join('\n')

  const systemPromptOverride = substitute(prompt?.promptText ?? DEFAULT_STRUCTURE_CARE_PROMPT, {
    question_text: q.text,
    topic,
    goal,
    scale_type: scaleType,
    probe_rules: probeRulesText,
  })

  const config = await loadAiConfig(orgId, { purpose: 'structuring', preferId: body.aiConfigId })

  // Деградация: при провале LLM возвращаем partial без careReady.
  let breakdown
  try {
    breakdown = await structureQuestionCare(
      {
        provider: config.provider as SupportedProvider,
        model: config.model,
        apiKeyEncrypted: config.apiKeyEncrypted,
        baseUrl: config.baseUrl,
        maxTokens: config.maxTokens,
      },
      {
        questionText: q.text,
        topic,
        goal,
        scaleType,
        systemPromptOverride,
        probeLimitPerElement: methodology.probeLimitPerElement,
        probeLimitPerQuestion: methodology.probeLimitPerQuestion,
      },
    )
  }
  catch {
    setResponseStatus(event, 200)
    return { partial: true, message: 'Не удалось структурировать по CARE. Отредактируйте вручную.' }
  }

  // Транзакция: заменить AI-probe, сохранить breakdown, careReady=true.
  const saved = await db.transaction(async (tx) => {
    await tx.delete(bankQuestionProbe)
      .where(and(
        eq(bankQuestionProbe.bankQuestionId, id),
        eq(bankQuestionProbe.organizationId, orgId),
        eq(bankQuestionProbe.probeSource, 'ai_structured'),
      ))

    let order = 0
    const probeRows = []
    for (const el of breakdown.elements) {
      for (const p of el.probes) {
        const [row] = await tx.insert(bankQuestionProbe).values({
          organizationId: orgId,
          bankQuestionId: id,
          careElement: el.element,
          text: p,
          probeSource: 'ai_structured',
          displayOrder: order++,
        }).returning()
        probeRows.push(row)
      }
    }

    const [updated] = await tx.update(bankQuestion)
      .set({
        careBreakdown: breakdown,
        careReady: true,
        structuredWithVersion: methodology.version,
        structuredAt: new Date(),
        structuredById: session.user.id,
        updatedAt: new Date(),
      })
      .where(and(eq(bankQuestion.id, id), eq(bankQuestion.organizationId, orgId)))
      .returning()

    return { question: updated, probes: probeRows }
  })

  return { breakdown, probes: saved.probes, methodologyVersion: methodology.version, partial: false }
})
