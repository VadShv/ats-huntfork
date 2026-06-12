import { describe, it, expect } from 'vitest'
import { sanitizeChunk, sanitizeLine } from '../../server/utils/ai/yandexFetch'

describe('yandexFetch sanitizer', () => {
  describe('sanitizeChunk', () => {
    it("coerces type='' to 'function' and preserves empty id/name", () => {
      const input = {
        id: 'chatcmpl-1',
        choices: [{
          index: 0,
          delta: {
            tool_calls: [{ index: 0, id: '', type: '', function: { name: '', arguments: 'c' } }],
          },
        }],
      }
      const out = sanitizeChunk(input) as typeof input
      const tc = out.choices[0].delta.tool_calls[0] as Record<string, unknown>
      // type is coerced to 'function' so Zod schema passes
      expect(tc.type).toBe('function')
      // id/name kept as empty string — SDK accumulates them across deltas
      expect(tc.id).toBe('')
      expect((tc.function as Record<string, unknown>).name).toBe('')
      // 'c' is non-empty so left alone (not parseable JSON yet, SDK accumulates)
      expect((tc.function as Record<string, unknown>).arguments).toBe('c')
    })

    it("coerces empty arguments '' to '{}' so SDK can finalise tool-call", () => {
      const input = {
        choices: [{
          index: 0,
          delta: {
            tool_calls: [{ index: 0, id: 'tc_1', type: 'function', function: { name: 'list_jobs', arguments: '' } }],
          },
        }],
      }
      const out = sanitizeChunk(input) as typeof input
      const tc = out.choices[0].delta.tool_calls[0] as Record<string, unknown>
      const fn = tc.function as Record<string, unknown>
      expect(fn.arguments).toBe('{}')
      expect(fn.name).toBe('list_jobs')
    })

    it("leaves type='function' untouched", () => {
      const input = {
        choices: [{
          index: 0,
          delta: {
            tool_calls: [{ index: 0, id: 'tc_1', type: 'function', function: { name: 'list_jobs' } }],
          },
        }],
      }
      const out = sanitizeChunk(input) as typeof input
      const tc = out.choices[0].delta.tool_calls[0] as Record<string, unknown>
      expect(tc.type).toBe('function')
      expect(tc.id).toBe('tc_1')
    })

    it('preserves non-empty arguments delta', () => {
      const input = {
        choices: [{
          index: 0,
          delta: {
            tool_calls: [{ index: 0, function: { arguments: '{"a":1}' } }],
          },
        }],
      }
      const out = sanitizeChunk(input) as typeof input
      const tc = out.choices[0].delta.tool_calls[0] as Record<string, unknown>
      expect((tc.function as Record<string, unknown>).arguments).toBe('{"a":1}')
    })

    it('leaves omitted arguments field untouched (no coercion)', () => {
      const input = {
        choices: [{
          index: 0,
          delta: {
            tool_calls: [{ index: 0, function: { name: 'list_jobs' } }],
          },
        }],
      }
      const out = sanitizeChunk(input) as typeof input
      const fn = (out.choices[0].delta.tool_calls[0] as Record<string, unknown>).function as Record<string, unknown>
      expect(fn.arguments).toBeUndefined()
      expect(fn.name).toBe('list_jobs')
    })

    it('returns chunk unchanged when no tool_calls present', () => {
      const input = { choices: [{ index: 0, delta: { content: 'hello' } }] }
      const out = sanitizeChunk(input)
      expect(out).toBe(input)
    })

    it('handles chunks with no choices', () => {
      const input = { id: 'x' }
      expect(sanitizeChunk(input)).toBe(input)
    })

    it('handles non-record input', () => {
      expect(sanitizeChunk(null)).toBe(null)
      expect(sanitizeChunk('foo')).toBe('foo')
      expect(sanitizeChunk(42)).toBe(42)
    })
  })

  describe('sanitizeLine', () => {
    it('rewrites broken SSE data line', () => {
      const line = 'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"","type":"","function":{"name":"","arguments":"c"}}]}}]}'
      const out = sanitizeLine(line)
      const json = JSON.parse(out.slice('data: '.length))
      const tc = json.choices[0].delta.tool_calls[0]
      expect(tc.type).toBe('function')
      expect(tc.id).toBe('')
      expect(tc.function.name).toBe('')
      expect(tc.function.arguments).toBe('c')
    })

    it('handles the real Yandex list_jobs no-args chunk end-to-end', () => {
      const line = 'data: {"id":"chatcmpl-x","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"tc_1","type":"function","function":{"name":"list_jobs","arguments":""}}]}}]}'
      const out = sanitizeLine(line)
      const tc = JSON.parse(out.slice('data: '.length)).choices[0].delta.tool_calls[0]
      expect(tc.function.arguments).toBe('{}')
    })

    it('passes [DONE] sentinel through untouched', () => {
      expect(sanitizeLine('data: [DONE]')).toBe('data: [DONE]')
    })

    it('passes non-data lines through untouched', () => {
      expect(sanitizeLine('')).toBe('')
      expect(sanitizeLine(': keepalive')).toBe(': keepalive')
      expect(sanitizeLine('event: ping')).toBe('event: ping')
    })

    it('passes through clean OpenAI-compliant chunks', () => {
      const line = 'data: {"choices":[{"index":0,"delta":{"content":"Hello"}}]}'
      expect(sanitizeLine(line)).toBe(line)
    })

    it('passes through invalid JSON without crashing', () => {
      const line = 'data: {not json'
      expect(sanitizeLine(line)).toBe(line)
    })
  })
})
