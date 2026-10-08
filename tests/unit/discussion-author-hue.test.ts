import { describe, it, expect } from 'vitest'
import { authorHue } from '../../app/composables/useDiscussionColors'

/**
 * Цвет автора в обсуждении (визуальная версия 1): детерминированный оттенок
 * из фиксированной палитры, без бирюзы ИИ (180).
 */
describe('authorHue', () => {
  it('один и тот же id → один и тот же оттенок', () => {
    expect(authorHue('user-1')).toBe(authorHue('user-1'))
    expect(authorHue('a7f3c2')).toBe(authorHue('a7f3c2'))
  })

  it('пустой id → брендовый оттенок по умолчанию', () => {
    expect(authorHue(null)).toBe(264)
    expect(authorHue(undefined)).toBe(264)
    expect(authorHue('')).toBe(264)
  })

  it('оттенки из палитры, бирюза ИИ не используется', () => {
    const palette = new Set([264, 150, 30, 330, 210, 80, 300, 15])
    for (let i = 0; i < 200; i++) {
      const h = authorHue(`id-${i}-${i * 7919}`)
      expect(palette.has(h)).toBe(true)
      expect(h).not.toBe(180)
    }
  })

  it('разные id распределяются по нескольким оттенкам', () => {
    const seen = new Set<number>()
    for (let i = 0; i < 64; i++) seen.add(authorHue(`member-${i}`))
    expect(seen.size).toBeGreaterThanOrEqual(5)
  })
})
