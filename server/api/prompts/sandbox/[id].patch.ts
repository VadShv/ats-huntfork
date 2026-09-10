import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { promptSandbox } from '../../../database/schema'
import { requirePermission } from '../../../utils/requirePermission'

const SYSTEM_PROMPT_MAX = 16_000

const variableSchema = z.object({
  name: z.string().min(1).max(60),
  description: z.string().max(200),
  required: z.boolean(),
  example: z.string().max(500).optional(),
})

const bodySchema = z.object({
  name: z.string().min(1).max(200).trim().optional(),
  description: z.string().max(500).trim().optional().nullable(),
  category: z.string().max(60).optional(),
  systemPrompt: z.string().min(1).max(SYSTEM_PROMPT_MAX).optional(),
  userPromptTemplate: z.string().max(SYSTEM_PROMPT_MAX).optional().nullable(),
  variables: z.array(variableSchema).max(30).optional().nullable(),
  aiConfigId: z.string().min(1).optional().nullable(),
  temperature: z.number().min(0).max(2).optional().nullable(),
  modelOverride: z.string().max(200).optional().nullable(),
  isShared: z.boolean().optional(),
  tags: z.array(z.string().max(40)).max(20).optional().nullable(),
})

/**
 * PATCH /api/prompts/sandbox/:id
 * Update a sandbox prompt. Only the owner can edit.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { scoring: ['create'] })
  const orgId = session.session.activeOrganizationId
  const userId = session.user.id

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Не указан id' })

  const body = await readValidatedBody(event, bodySchema.parse)

  const existing = await db.query.promptSandbox.findFirst({
    where: and(
      eq(promptSandbox.id, id),
      eq(promptSandbox.organizationId, orgId),
    ),
  })

  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Промпт не найден' })
  if (existing.userId !== userId) {
    throw createError({ statusCode: 403, statusMessage: 'Только владелец может редактировать промпт' })
  }

  const updates: Partial<typeof promptSandbox.$inferInsert> = { updatedAt: new Date() }
  if (body.name !== undefined) updates.name = body.name
  if (body.description !== undefined) updates.description = body.description
  if (body.category !== undefined) updates.category = body.category
  if (body.systemPrompt !== undefined) updates.systemPrompt = body.systemPrompt
  if (body.userPromptTemplate !== undefined) updates.userPromptTemplate = body.userPromptTemplate
  if (body.variables !== undefined) updates.variables = body.variables
  if (body.aiConfigId !== undefined) updates.aiConfigId = body.aiConfigId
  if (body.temperature !== undefined) updates.temperature = typeof body.temperature === 'number' ? String(body.temperature) : null
  if (body.modelOverride !== undefined) updates.modelOverride = body.modelOverride
  if (body.isShared !== undefined) updates.isShared = body.isShared
  if (body.tags !== undefined) updates.tags = body.tags

  const [updated] = await db.update(promptSandbox)
    .set(updates)
    .where(eq(promptSandbox.id, id))
    .returning()

  if (!updated) throw createError({ statusCode: 500, statusMessage: 'Не удалось обновить промпт' })

  return { prompt: updated }
})
