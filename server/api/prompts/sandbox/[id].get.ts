import { and, eq } from 'drizzle-orm'
import { promptSandbox } from '../../../database/schema'
import { requirePermission } from '../../../utils/requirePermission'

/**
 * GET /api/prompts/sandbox/:id
 * Get a single sandbox prompt. Visible to owner or shared-in-org.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { scoring: ['read'] })
  const orgId = session.session.activeOrganizationId
  const userId = session.user.id

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Не указан id' })

  const row = await db.query.promptSandbox.findFirst({
    where: and(
      eq(promptSandbox.id, id),
      eq(promptSandbox.organizationId, orgId),
    ),
  })

  if (!row) throw createError({ statusCode: 404, statusMessage: 'Промпт не найден' })

  if (row.userId !== userId && !row.isShared) {
    throw createError({ statusCode: 403, statusMessage: 'Нет доступа к этому промпту' })
  }

  return {
    prompt: {
      id: row.id,
      name: row.name,
      description: row.description,
      category: row.category,
      systemPrompt: row.systemPrompt,
      userPromptTemplate: row.userPromptTemplate,
      variables: row.variables,
      aiConfigId: row.aiConfigId,
      temperature: row.temperature ? Number(row.temperature) : null,
      modelOverride: row.modelOverride,
      isShared: row.isShared,
      tags: row.tags,
      isOwner: row.userId === userId,
      lastTestResult: row.lastTestResult,
      lastTestedAt: row.lastTestedAt?.getTime() ?? null,
      createdAt: row.createdAt.getTime(),
      updatedAt: row.updatedAt.getTime(),
    },
  }
})
