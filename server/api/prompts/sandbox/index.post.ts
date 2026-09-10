import { and, count, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { promptSandbox } from '../../../database/schema'
import { requirePermission } from '../../../utils/requirePermission'

const MAX_PROMPTS_PER_USER = 100
const SYSTEM_PROMPT_MAX = 16_000

const variableSchema = z.object({
  name: z.string().min(1).max(60),
  description: z.string().max(200),
  required: z.boolean(),
  example: z.string().max(500).optional(),
})

const bodySchema = z.object({
  name: z.string().min(1).max(200).trim(),
  description: z.string().max(500).trim().optional().nullable(),
  category: z.string().max(60).default('custom'),
  systemPrompt: z.string().min(1).max(SYSTEM_PROMPT_MAX),
  userPromptTemplate: z.string().max(SYSTEM_PROMPT_MAX).optional().nullable(),
  variables: z.array(variableSchema).max(30).optional().nullable(),
  aiConfigId: z.string().min(1).optional().nullable(),
  temperature: z.number().min(0).max(2).optional().nullable(),
  modelOverride: z.string().max(200).optional().nullable(),
  isShared: z.boolean().optional(),
  tags: z.array(z.string().max(40)).max(20).optional().nullable(),
})

/**
 * POST /api/prompts/sandbox
 * Create a new sandbox prompt.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { scoring: ['create'] })
  const orgId = session.session.activeOrganizationId
  const userId = session.user.id

  const body = await readValidatedBody(event, bodySchema.parse)

  const created = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`prompt_sandbox:${orgId}:${userId}`}))`,
    )

    const [{ value: existing } = { value: 0 }] = await tx
      .select({ value: count() })
      .from(promptSandbox)
      .where(and(
        eq(promptSandbox.organizationId, orgId),
        eq(promptSandbox.userId, userId),
      ))

    if (existing >= MAX_PROMPTS_PER_USER) {
      throw createError({
        statusCode: 422,
        statusMessage: `Достигнут лимит промптов (${MAX_PROMPTS_PER_USER}). Удалите промпт перед созданием нового`,
      })
    }

    const [row] = await tx.insert(promptSandbox).values({
      organizationId: orgId,
      userId,
      name: body.name,
      description: body.description ?? null,
      category: body.category,
      systemPrompt: body.systemPrompt,
      userPromptTemplate: body.userPromptTemplate ?? null,
      variables: body.variables ?? null,
      aiConfigId: body.aiConfigId ?? null,
      temperature: typeof body.temperature === 'number' ? String(body.temperature) : null,
      modelOverride: body.modelOverride ?? null,
      isShared: body.isShared === true,
      tags: body.tags ?? null,
    }).returning()

    return row
  })

  if (!created) {
    throw createError({ statusCode: 500, statusMessage: 'Не удалось создать промпт' })
  }

  return { prompt: created }
})
