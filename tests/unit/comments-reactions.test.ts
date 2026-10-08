import { describe, it, expect } from 'vitest'
import { decodeReactionEmoji, ALLOWED_REACTION_EMOJI } from '../../server/utils/comments/reactions'

describe('decodeReactionEmoji', () => {
  it('декодирует percent-encoded сегмент URL', () => {
    for (const emoji of ALLOWED_REACTION_EMOJI) {
      expect(decodeReactionEmoji(encodeURIComponent(emoji))).toBe(emoji)
    }
  })

  it('не ломает уже декодированное значение', () => {
    expect(decodeReactionEmoji('👍')).toBe('👍')
  })

  it('переживает битую строку', () => {
    expect(decodeReactionEmoji('%E2%9D')).toBe('%E2%9D')
  })

  it('нормализует к NFC', () => {
    const nfd = '❤️'.normalize('NFD')
    expect(decodeReactionEmoji(nfd)).toBe('❤️'.normalize('NFC'))
  })
})
