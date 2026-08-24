/**
 * Resolve the AI configuration to use for a given purpose.
 *
 * Resolution order:
 *   1. `preferId` — if provided AND it belongs to the org, use it.
 *   2. The org's default config for the requested purpose (chatbot / analysis / interactive).
 *      П2: for `interactive` (быстрые задачи панели Sidekick) with no default set,
 *      fall back to the `analysis` default — поведение до назначения не меняется.
 *   3. Throw 422 with a helpful message pointing to Settings → AI.
 *
 * One org may have many configurations; exactly one can be the default per purpose.
 */
import { and, eq } from 'drizzle-orm'
import { aiConfig } from '../../database/schema'

export type AiConfigPurpose = 'chatbot' | 'analysis' | 'interactive'

const PURPOSE_LABELS: Record<AiConfigPurpose, string> = {
  chatbot: 'ассистента',
  analysis: 'анализ кандидата',
  interactive: 'быстрые задачи панели',
}

export async function loadAiConfig(
  orgId: string,
  opts: { purpose: AiConfigPurpose, preferId?: string | null },
) {
  if (opts.preferId) {
    const found = await db.query.aiConfig.findFirst({
      where: and(eq(aiConfig.id, opts.preferId), eq(aiConfig.organizationId, orgId)),
    })
    if (found) return found
    // Fall through to default — UI may have a stale id; don't fail hard.
  }

  const defaultCol = opts.purpose === 'chatbot'
    ? aiConfig.isDefaultChatbot
    : opts.purpose === 'interactive'
      ? aiConfig.isDefaultInteractive
      : aiConfig.isDefaultAnalysis

  const def = await db.query.aiConfig.findFirst({
    where: and(eq(aiConfig.organizationId, orgId), eq(defaultCol, true)),
  })
  if (def) return def

  // П2: интерактивный дефолт не назначен — используем дефолт «анализа»,
  // как это работало до появления purpose 'interactive'.
  if (opts.purpose === 'interactive') {
    const analysisDef = await db.query.aiConfig.findFirst({
      where: and(eq(aiConfig.organizationId, orgId), eq(aiConfig.isDefaultAnalysis, true)),
    })
    if (analysisDef) return analysisDef
  }

  // No default — try ANY config so a single-config org never sees an error.
  const any = await db.query.aiConfig.findFirst({
    where: eq(aiConfig.organizationId, orgId),
  })
  if (any) return any

  throw createError({
    statusCode: 422,
    statusMessage: `Поставщик ИИ не настроен. Добавьте его в Настройках → ИИ, чтобы включить ${PURPOSE_LABELS[opts.purpose]}`,
  })
}
