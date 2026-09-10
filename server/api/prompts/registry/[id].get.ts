import { getPromptById } from '../../../utils/ai/promptRegistry'

/**
 * GET /api/prompts/registry/:id
 *
 * Returns a single production prompt by its stable id.
 */
export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session) {
    throw createError({ statusCode: 401, statusMessage: 'Требуется вход' })
  }

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Не указан id промпта' })
  }

  const prompt = getPromptById(id)
  if (!prompt) {
    throw createError({ statusCode: 404, statusMessage: 'Промпт не найден' })
  }

  return prompt
})
