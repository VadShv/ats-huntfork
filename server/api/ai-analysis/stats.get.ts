import { eq, and, desc, sql, count, sum } from 'drizzle-orm'
import { analysisRun, job, application, candidate, aiConfig, aiUsageEvent } from '../../database/schema'
import { requireAiUsageAccess } from '../../utils/ai/usage/query'

/**
 * GET /api/ai-analysis/stats
 * Returns AI analysis usage statistics for the current organization:
 * - Total runs, completed, failed
 * - Token usage (prompt + completion)
 * - Runs over time (last 30 days, grouped by day)
 * - Recent runs with job/candidate info
 * - Per-model breakdown
 * - usageJournal — фактический расход скрининга из журнала ai_usage_event
 *   (docs/tz-ai-usage.md §12): цена на момент вызова, а не текущая цена конфигурации.
 *   Поле добавочное; старый формат ответа не меняется.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { scoring: ['read'] })
  const orgId = session.session.activeOrganizationId

  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
  const thirtyDaysAgoISO = thirtyDaysAgo.toISOString()

  // Fetch pricing from ALL configs in the org so historical model breakdown
  // can be priced correctly even if the user has multiple configurations.
  const pricingConfigs = await db.query.aiConfig.findMany({
    where: eq(aiConfig.organizationId, orgId),
    columns: {
      provider: true,
      model: true,
      inputPricePer1m: true,
      outputPricePer1m: true,
      isDefaultAnalysis: true,
    },
  })

  const pricingByModel = new Map<string, { inputPricePer1m: number | null, outputPricePer1m: number | null }>()
  for (const c of pricingConfigs) {
    pricingByModel.set(`${c.provider}::${c.model}`, {
      inputPricePer1m: c.inputPricePer1m != null ? Number(c.inputPricePer1m) : null,
      outputPricePer1m: c.outputPricePer1m != null ? Number(c.outputPricePer1m) : null,
    })
  }
  const defaultAnalysisConfig = pricingConfigs.find(c => c.isDefaultAnalysis) ?? pricingConfigs[0] ?? null

  const [
    totalRuns,
    completedRuns,
    failedRuns,
    tokenUsage,
    dailyRuns,
    recentRuns,
    modelBreakdown,
  ] = await Promise.all([
    // 1. Total runs
    db.$count(analysisRun, eq(analysisRun.organizationId, orgId)),

    // 2. Completed runs
    db.$count(analysisRun, and(eq(analysisRun.organizationId, orgId), eq(analysisRun.status, 'completed'))),

    // 3. Failed runs
    db.$count(analysisRun, and(eq(analysisRun.organizationId, orgId), eq(analysisRun.status, 'failed'))),

    // 4. Total token usage
    db
      .select({
        totalPromptTokens: sum(analysisRun.promptTokens).as('total_prompt_tokens'),
        totalCompletionTokens: sum(analysisRun.completionTokens).as('total_completion_tokens'),
      })
      .from(analysisRun)
      .where(eq(analysisRun.organizationId, orgId)),

    // 5. Daily runs (last 30 days)
    db
      .select({
        date: sql<string>`DATE(${analysisRun.createdAt})`.as('date'),
        count: count().as('count'),
        promptTokens: sum(analysisRun.promptTokens).as('prompt_tokens'),
        completionTokens: sum(analysisRun.completionTokens).as('completion_tokens'),
      })
      .from(analysisRun)
      .where(and(
        eq(analysisRun.organizationId, orgId),
        sql`${analysisRun.createdAt} >= ${thirtyDaysAgoISO}`,
      ))
      .groupBy(sql`DATE(${analysisRun.createdAt})`)
      .orderBy(sql`DATE(${analysisRun.createdAt})`),

    // 6. Recent runs (last 20)
    db
      .select({
        id: analysisRun.id,
        status: analysisRun.status,
        provider: analysisRun.provider,
        model: analysisRun.model,
        compositeScore: analysisRun.compositeScore,
        promptTokens: analysisRun.promptTokens,
        completionTokens: analysisRun.completionTokens,
        createdAt: analysisRun.createdAt,
        candidateFirstName: candidate.firstName,
        candidateLastName: candidate.lastName,
        jobTitle: job.title,
      })
      .from(analysisRun)
      .innerJoin(application, eq(application.id, analysisRun.applicationId))
      .innerJoin(candidate, eq(candidate.id, application.candidateId))
      .innerJoin(job, eq(job.id, application.jobId))
      .where(eq(analysisRun.organizationId, orgId))
      .orderBy(desc(analysisRun.createdAt))
      .limit(20),

    // 7. Per-model breakdown
    db
      .select({
        provider: analysisRun.provider,
        model: analysisRun.model,
        runCount: count().as('run_count'),
        totalPromptTokens: sum(analysisRun.promptTokens).as('total_prompt_tokens'),
        totalCompletionTokens: sum(analysisRun.completionTokens).as('total_completion_tokens'),
      })
      .from(analysisRun)
      .where(eq(analysisRun.organizationId, orgId))
      .groupBy(analysisRun.provider, analysisRun.model),
  ])

  const usage = tokenUsage[0]

  // Фактический расход из журнала — только при праве видеть суммы (§9).
  let usageJournal: {
    currency: string
    totalCost: number
    totalCalls: number
    byModel: Array<{ provider: string, model: string, cost: number, calls: number }>
    byDay: Array<{ date: string, cost: number }>
  } | null = null
  const usageAccess = await requireAiUsageAccess(event, 'view_costs').catch(() => null)
  if (usageAccess) {
    const e = aiUsageEvent
    const screening = and(eq(e.organizationId, orgId), eq(e.feature, 'screening'))
    const [jm, jd] = await Promise.all([
      db.select({
        provider: e.provider,
        model: e.model,
        cost: sql<number>`coalesce(sum(${e.costBase}), 0)::float8`,
        calls: sql<number>`count(*)::int`,
      }).from(e).where(screening).groupBy(e.provider, e.model),
      db.select({
        date: sql<string>`DATE(${e.createdAt})`,
        cost: sql<number>`coalesce(sum(${e.costBase}), 0)::float8`,
      }).from(e).where(and(screening, sql`${e.createdAt} >= ${thirtyDaysAgoISO}`))
        .groupBy(sql`DATE(${e.createdAt})`).orderBy(sql`DATE(${e.createdAt})`),
    ])
    usageJournal = {
      currency: usageAccess.currency.baseCurrency,
      totalCost: jm.reduce((acc, r) => acc + Number(r.cost), 0),
      totalCalls: jm.reduce((acc, r) => acc + Number(r.calls), 0),
      byModel: jm.map(r => ({ provider: r.provider, model: r.model, cost: Number(r.cost), calls: Number(r.calls) })),
      byDay: jd.map(r => ({ date: String(r.date), cost: Number(r.cost) })),
    }
  }

  const inputPrice = defaultAnalysisConfig?.inputPricePer1m != null ? Number(defaultAnalysisConfig.inputPricePer1m) : null
  const outputPrice = defaultAnalysisConfig?.outputPricePer1m != null ? Number(defaultAnalysisConfig.outputPricePer1m) : null

  return {
    pricing: {
      inputPricePer1m: inputPrice,
      outputPricePer1m: outputPrice,
      configured: inputPrice != null || outputPrice != null,
    },
    summary: {
      totalRuns: Number(totalRuns),
      completedRuns: Number(completedRuns),
      failedRuns: Number(failedRuns),
      totalPromptTokens: Number(usage?.totalPromptTokens ?? 0),
      totalCompletionTokens: Number(usage?.totalCompletionTokens ?? 0),
      totalTokens: Number(usage?.totalPromptTokens ?? 0) + Number(usage?.totalCompletionTokens ?? 0),
    },
    dailyRuns: dailyRuns.map(d => ({
      date: d.date,
      count: Number(d.count),
      promptTokens: Number(d.promptTokens ?? 0),
      completionTokens: Number(d.completionTokens ?? 0),
    })),
    recentRuns: recentRuns.map(r => ({
      id: r.id,
      status: r.status,
      provider: r.provider,
      model: r.model,
      compositeScore: r.compositeScore,
      promptTokens: r.promptTokens,
      completionTokens: r.completionTokens,
      createdAt: r.createdAt,
      candidateName: `${r.candidateFirstName} ${r.candidateLastName}`,
      jobTitle: r.jobTitle,
    })),
    usageJournal,
    modelBreakdown: modelBreakdown.map((m) => {
      const price = pricingByModel.get(`${m.provider}::${m.model}`)
      const promptTokens = Number(m.totalPromptTokens ?? 0)
      const completionTokens = Number(m.totalCompletionTokens ?? 0)
      return {
        provider: m.provider,
        model: m.model,
        runCount: Number(m.runCount),
        totalPromptTokens: promptTokens,
        totalCompletionTokens: completionTokens,
        totalTokens: promptTokens + completionTokens,
        inputPricePer1m: price?.inputPricePer1m ?? null,
        outputPricePer1m: price?.outputPricePer1m ?? null,
      }
    }),
  }
})
