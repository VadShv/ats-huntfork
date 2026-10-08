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

describe('наборы реакций согласованы', async () => {
  const { REACTION_EMOJI_SET, QUICK_REACTION_EMOJI } = await import('../../app/composables/useReactionEmojis')
  it('клиентский набор равен серверному allow-list', () => {
    expect([...REACTION_EMOJI_SET]).toEqual([...ALLOWED_REACTION_EMOJI])
  })
  it('быстрые реакции — подмножество набора', () => {
    for (const e of QUICK_REACTION_EMOJI) expect(REACTION_EMOJI_SET).toContain(e)
    expect(QUICK_REACTION_EMOJI).toHaveLength(4)
  })
})
