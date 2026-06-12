/**
 * Yandex Foundation Models streaming SSE sanitizer.
 *
 * Why this exists:
 *   Yandex Cloud exposes an OpenAI-compatible chat-completions endpoint
 *   (`https://llm.api.cloud.yandex.net/v1/chat/completions`). However, for some
 *   models (notably `gpt://…/qwen3-235b-a22b-fp8/latest`) the streaming
 *   `tool_calls` deltas violate the OpenAI Chat Completions schema in two ways:
 *
 *     1. The very first delta sometimes carries `type: ""` instead of
 *        `type: "function"`. Subsequent deltas omit `type` entirely.
 *     2. The first delta carries `id: ""` and the actual tool-call id is sent
 *        in a later chunk.
 *
 *   The Vercel AI SDK validates each SSE chunk with Zod (`type: z.literal('function')`),
 *   so the stream fails with `Type validation failed: … expected "function"`.
 *
 * What we do:
 *   We wrap `fetch` and transform the SSE response body line-by-line. For each
 *   `data: { … "tool_calls": [...] }` payload we:
 *     - Drop `type: ""` (downstream tolerates missing `type`; only `type:
 *       "function"` is allowed when present).
 *     - Drop `id: ""` and empty `function: { name: "", arguments: "" }` slots
 *       so the SDK accumulates them across deltas without re-validating empty
 *       strings as new tool calls.
 *
 *   Non-tool-call chunks pass through untouched. The sanitizer is byte-safe
 *   (operates only on full lines) and idempotent.
 *
 *   Only used when provider === 'yandex'. Other providers use the stock fetch.
 */

export function createYandexFetch(): typeof fetch {
  return async function yandexFetch(input: RequestInfo | URL, init?: RequestInit) {
    const response = await fetch(input, init)

    const contentType = response.headers.get('content-type') || ''
    // Only intercept Server-Sent Event streams. JSON (non-streaming) responses
    // and errors flow through unchanged.
    if (!contentType.includes('text/event-stream') || !response.body) {
      return response
    }

    const transformed = response.body.pipeThrough(makeSseSanitizer())

    // Preserve all headers + status; replace only the body.
    return new Response(transformed, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })
  }
}

function makeSseSanitizer(): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder('utf-8')
  const encoder = new TextEncoder()
  let buffer = ''

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true })

      // SSE messages are newline-delimited. Process complete lines only,
      // keeping any trailing partial line in the buffer for the next chunk.
      let newlineIdx: number
      while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIdx)
        buffer = buffer.slice(newlineIdx + 1)
        controller.enqueue(encoder.encode(`${sanitizeLine(line)}\n`))
      }
    },
    flush(controller) {
      if (buffer.length > 0) {
        controller.enqueue(encoder.encode(sanitizeLine(buffer)))
        buffer = ''
      }
    },
  })
}

export function sanitizeLine(line: string): string {
  // SSE event format: `data: <json>` (with optional leading whitespace).
  // Anything else (event/id/retry/comments/blank lines) passes through.
  const match = line.match(/^(data:\s*)(.+)$/)
  if (!match) return line
  const [, prefix, payload] = match

  // Sentinel terminator — not JSON.
  if (payload === '[DONE]') return line

  let obj: unknown
  try {
    obj = JSON.parse(payload)
  } catch {
    // Not JSON — leave untouched.
    return line
  }

  const fixed = sanitizeChunk(obj)
  if (fixed === obj) return line
  return `${prefix}${JSON.stringify(fixed)}`
}

/**
 * Normalise an OpenAI-style chat-completion-chunk that came from Yandex.
 * Returns the same reference unchanged if no fix was needed.
 */
export function sanitizeChunk(chunk: unknown): unknown {
  if (!isRecord(chunk)) return chunk
  const choices = chunk.choices
  if (!Array.isArray(choices) || choices.length === 0) return chunk

  let mutated = false
  const fixedChoices = choices.map((choice) => {
    if (!isRecord(choice)) return choice
    const delta = choice.delta
    if (!isRecord(delta)) return choice
    const toolCalls = delta.tool_calls
    if (!Array.isArray(toolCalls) || toolCalls.length === 0) return choice

    const fixedToolCalls: unknown[] = []
    let toolCallsChanged = false

    for (const tc of toolCalls) {
      if (!isRecord(tc)) {
        fixedToolCalls.push(tc)
        continue
      }
      const cleaned: Record<string, unknown> = { ...tc }

      // FIX 1: Coerce `type: ""` (Yandex's broken first delta for Qwen3) to
      // the canonical `type: "function"`. The SDK's Zod schema requires the
      // literal "function" when the field is present; an empty string would
      // fail validation outright.
      if (cleaned.type === '') {
        cleaned.type = 'function'
        toolCallsChanged = true
      }

      // FIX 2: Coerce empty `function.arguments` ("") to `"{}"` so the AI
      // SDK can finalise the tool-call.
      //
      // Why: the SDK only emits a `tool-call` event when
      // `isParsableJson(arguments)` returns true (see
      // @ai-sdk/openai chat-completions stream handler). An empty string is
      // NOT parseable. Yandex sends tools-without-parameters (e.g.
      // `list_jobs`) as a single chunk with `arguments: ""` followed by
      // `finish_reason: "tool_calls"` — the SDK then drops the tool call
      // entirely, manifesting as `tool-input-start` with no matching
      // `tool-call`, and `finishReason: tool-calls` without any executed
      // tools.
      //
      // Substituting `"{}"` is safe: it represents "no arguments" and
      // matches what Zod tool schemas with no required fields accept.
      if (isRecord(cleaned.function) && cleaned.function.arguments === '') {
        cleaned.function = { ...cleaned.function, arguments: '{}' }
        toolCallsChanged = true
      }

      // FIX 3: Leave `id` and `function.name` untouched. The AI SDK
      // accumulates these field-by-field across deltas using `index`.

      fixedToolCalls.push(cleaned)
    }

    if (!toolCallsChanged) return choice
    mutated = true
    return { ...choice, delta: { ...delta, tool_calls: fixedToolCalls } }
  })

  if (!mutated) return chunk
  return { ...chunk, choices: fixedChoices }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
