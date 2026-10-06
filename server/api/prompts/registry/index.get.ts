import { PRODUCTION_PROMPTS, PROMPT_CATEGORIES, type PromptCategory } from '../../../utils/ai/promptRegistry'
import { loadPromptUsage } from '../../../utils/ai/usage/promptUsage'

/**
 * GET /api/prompts/registry
 *
 * Returns all production AI prompts (read-only).
 * Optionally filter by category: ?category=scoring
 * usage30d — вызовы и расход за 30 дней (если есть aiUsage:view_own+, docs/tz-ai-usage.md §8.4).
 */
export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session) {
    throw createError({ statusCode: 401, statusMessage: 'Требуется вход' })
  }

  const query = getQuery(event)
  const category = query.category as PromptCategory | undefined

  const prompts = category
    ? PRODUCTION_PROMPTS.filter(p => p.category === category)
    : PRODUCTION_PROMPTS

  const usage = await loadPromptUsage(event).catch(() => null)

  return {
    prompts: prompts.map(p => ({ ...p, usage30d: usage ? usage.forPrompt(p) : null })),
    categories: PROMPT_CATEGORIES,
    total: prompts.length,
    usageCurrency: usage?.currency ?? null,
    usageCanViewCosts: usage?.canViewCosts ?? false,
  }
})
