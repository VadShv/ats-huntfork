import { describe, it, expect } from 'vitest'
import { parseMentionTokens } from '../../server/utils/comments/mention-parser'

describe('parseMentionTokens', () => {
  it('returns empty array on empty input', () => {
    expect(parseMentionTokens('')).toEqual([])
    expect(parseMentionTokens('   ')).toEqual([])
  })

  it('extracts quoted full-name mentions', () => {
    const out = parseMentionTokens('Привет @"Иван Иванов", посмотри')
    expect(out).toContain('Иван Иванов')
  })

  it('extracts bare username mentions', () => {
    const out = parseMentionTokens('@ivan и @petr.s обсудите')
    expect(out).toEqual(expect.arrayContaining(['ivan', 'petr.s']))
  })

  it('handles Cyrillic bare mentions', () => {
    const out = parseMentionTokens('@Иван проверь, пожалуйста')
    expect(out).toContain('Иван')
  })

  it('deduplicates the same mention', () => {
    const out = parseMentionTokens('@ivan @ivan @ivan')
    expect(out).toEqual(['ivan'])
  })

  it('does not split a quoted name into bare tokens', () => {
    const out = parseMentionTokens('@"Иван Иванов" посмотри')
    expect(out).toContain('Иван Иванов')
    // Should NOT also produce "Иван" or "Иванов" as separate tokens
    expect(out).not.toContain('Иван')
    expect(out).not.toContain('Иванов')
  })

  it('surfaces tokens from @ inside emails (resolver decides validity)', () => {
    // The parser is permissive: it surfaces any token that follows an `@`,
    // including ones embedded in emails. The resolver decides what's a real
    // user (no false positives reach the DB).
    const out = parseMentionTokens('Пиши на mail@example.com')
    // Token is 'example.com' (matches `[\p{L}\p{N}._-]+`)
    expect(out).toContain('example.com')
  })

  it('supports dot/hyphen/underscore in bare usernames', () => {
    const out = parseMentionTokens('cc @ivan.petrov-jr @maria_s')
    expect(out).toEqual(expect.arrayContaining(['ivan.petrov-jr', 'maria_s']))
  })

  it('handles multiple quoted mentions', () => {
    const out = parseMentionTokens('Сделайте @"Иван Иванов" и @"Мария Петрова"')
    expect(out).toEqual(expect.arrayContaining(['Иван Иванов', 'Мария Петрова']))
  })

  it('ignores @ followed by no token', () => {
    const out = parseMentionTokens('что-то @ что-то')
    expect(out).toEqual([])
  })
})
