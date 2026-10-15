/**
 * Регрессия для карты поиска: structured-вызов Cloud.ru с disableThinking:true
 * (GLM/Qwen3.5/3.6 → клиент @ai-sdk/openai-compatible) обязан отправлять в API
 * JSON-схему (response_format.type = json_schema), а не только json_object —
 * иначе модель не видит форму ответа и «Секции» падают с «не по схеме».
 */
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { z } from 'zod'
import { encrypt } from '../../server/utils/encryption'

const SECRET = 'test-secret-for-search-map-provider-path-0123456789'

vi.stubGlobal('env', { BETTER_AUTH_SECRET: SECRET })

let generateStructuredOutput: typeof import('../../server/utils/ai/provider').generateStructuredOutput

beforeAll(async () => {
  ;(globalThis as any).AI_SDK_LOG_WARNINGS = false
  ;({ generateStructuredOutput } = await import('../../server/utils/ai/provider'))
})

function okResponse(content: string) {
  return new Response(JSON.stringify({
    id: 'r', object: 'chat.completion', created: 1, model: 'zai-org/GLM-5.2',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  }), { status: 200, headers: { 'content-type': 'application/json' } })
}

describe('generateStructuredOutput · cloud_ru · disableThinking', () => {
  it('отправляет json_schema и отключает thinking', async () => {
    const bodies: any[] = []
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)))
      return okResponse(JSON.stringify({ sections: [{ sectionType: 'keywords', items: [{ value: 'Python', note: null }] }] }))
    })
    try {
      const schema = z.object({ sections: z.array(z.object({ sectionType: z.string(), items: z.array(z.object({ value: z.string(), note: z.string().nullish() })) })) })
      const res = await generateStructuredOutput(
        { provider: 'cloud_ru', model: 'zai-org/GLM-5.2', apiKeyEncrypted: encrypt('key', SECRET), maxTokens: 4000 },
        { system: 's', prompt: 'p', schema, schemaName: 'searchMapSections', disableThinking: true },
      )
      expect(res.object.sections[0]!.items[0]!.value).toBe('Python')
      expect(bodies).toHaveLength(1)
      const body = bodies[0]
      expect(body.response_format?.type).toBe('json_schema')
      expect(body.response_format?.json_schema?.name).toBe('searchMapSections')
      expect(body.response_format?.json_schema?.schema?.properties?.sections?.type).toBe('array')
      expect(body.chat_template_kwargs?.enable_thinking).toBe(false)
    } finally {
      fetchSpy.mockRestore()
    }
  })
})
