import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { promptSandbox } from '../../../../database/schema'
import { requirePermission } from '../../../../utils/requirePermission'
import { loadAiConfig } from '../../../../utils/ai/loadConfig'
import { streamTextOutput, type SupportedProvider } from '../../../../utils/ai/provider'
import { createRateLimiter } from '../../../../utils/rateLimit'

const limiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 20,
  message: 'Слишком много тестовых запросов. Подождите немного',
})

const bodySchema = z.object({
  variables: z.record(z.string().max(10_000)).optional(),
  aiConfigId: z.string().min(1).optional(),
})

/**
 * POST /api/prompts/sandbox/:id/test
 *
 * Test a sandbox prompt against an AI configuration.
 * Substitutes variables into the system + user prompt templates and streams the response.
 *
 * Response: text/event-stream
 *   data: {"delta":"..."}  — text fragment
 *   data: {"done":true,"usage":{...},"model":"..."}
 *   data: {"error":"..."}
 */
export default defineEventHandler(async (event) => {
  await limiter(event)
  const session = await requirePermission(event, { scoring: ['read'] })
  const orgId = session.session.activeOrganizationId
  const userId = session.user.id

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Не указан id' })

  const body = await readValidatedBody(event, bodySchema.parse)

  const row = await db.query.promptSandbox.findFirst({
    where: eq(promptSandbox.id, id),
  })

  if (!row) throw createError({ statusCode: 404, statusMessage: 'Промпт не найден' })
  if (row.organizationId !== orgId) throw createError({ statusCode: 403, statusMessage: 'Нет доступа' })
  if (row.userId !== userId && !row.isShared) {
    throw createError({ statusCode: 403, statusMessage: 'Нет доступа к этому промпту' })
  }

  // Resolve AI config: body override → prompt's config → org 'analysis' default
  const preferConfigId = body.aiConfigId ?? row.aiConfigId ?? null
  const config = await loadAiConfig(orgId, { purpose: 'analysis', preferId: preferConfigId })

  // Substitute variables into prompts
  const vars = body.variables ?? {}
  const systemPrompt = substituteVariables(row.systemPrompt, vars)
  const userPrompt = row.userPromptTemplate
    ? substituteVariables(row.userPromptTemplate, vars)
    : undefined

  const providerConfig = {
    provider: config.provider as SupportedProvider,
    model: row.modelOverride ?? config.model,
    apiKeyEncrypted: config.apiKeyEncrypted,
    baseUrl: config.baseUrl,
    maxTokens: config.maxTokens,
  }

  setResponseHeaders(event, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  })

  const result = streamTextOutput(providerConfig, {
    system: systemPrompt,
    ...(userPrompt ? { prompt: userPrompt } : { prompt: 'Test: respond briefly.' }),
    maxOutputTokens: 2048,
  })

  const encoder = new TextEncoder()
  const writeEvent = (controller: ReadableStreamDefaultController, data: Record<string, unknown>) => {
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
  }

  let fullText = ''

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const part of result.fullStream) {
          switch (part.type) {
            case 'text-delta':
              fullText += part.text
              writeEvent(controller, { delta: part.text })
              break
            case 'error':
              console.error('[prompt-test] provider error:', part.error)
              writeEvent(controller, { error: 'Ошибка ИИ-провайдера' })
              break
            case 'finish':
              writeEvent(controller, {
                done: true,
                usage: {
                  promptTokens: part.totalUsage.inputTokens ?? 0,
                  completionTokens: part.totalUsage.outputTokens ?? 0,
                },
                model: config.model,
              })
              break
            default:
              break
          }
        }
      } catch (err) {
        console.error('[prompt-test] stream error:', err)
        writeEvent(controller, { error: 'Ошибка при тестировании промпта' })
      } finally {
        // Cache last test result — only for the owner (non-owners testing a
        // shared prompt must not overwrite the owner's cached result).
        if (row.userId === userId) {
          try {
            await db.update(promptSandbox)
              .set({
                lastTestResult: { text: fullText.slice(0, 10000), at: new Date().toISOString() },
                lastTestedAt: new Date(),
                updatedAt: new Date(),
              })
              .where(eq(promptSandbox.id, id))
          } catch { /* non-fatal */ }
        }
        controller.close()
      }
    },
  })

  return sendStream(event, stream)
})

/** Replace {{var}} placeholders with values from the map. */
function substituteVariables(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) => {
    return vars[name] ?? match
  })
}
