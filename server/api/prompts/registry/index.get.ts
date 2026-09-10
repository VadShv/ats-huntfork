import { PRODUCTION_PROMPTS, PROMPT_CATEGORIES, type PromptCategory } from '../../../utils/ai/promptRegistry'

/**
 * GET /api/prompts/registry
 *
 * Returns all production AI prompts (read-only).
 * Optionally filter by category: ?category=scoring
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

  return {
    prompts,
    categories: PROMPT_CATEGORIES,
    total: prompts.length,
  }
})
