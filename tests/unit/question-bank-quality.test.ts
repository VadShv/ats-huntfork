import { describe, it, expect } from 'vitest'
import { checkQuestionQuality, checkAnchorQuality, canPublish } from '../../server/utils/questions/qualityChecks'

const baseOpts = { hasTopic: true, hasGoal: true, topicActive: true, expectedSignal: 'сильный ответ' }

describe('checkQuestionQuality — блокирующие', () => {
  it('пустой текст → блок', () => {
    const r = checkQuestionQuality('', baseOpts)
    expect(r.blocking.some(b => b.code === 'empty')).toBe(true)
    expect(canPublish(r)).toBe(false)
  })

  it('нет темы → блок', () => {
    const r = checkQuestionQuality('Расскажите про сложную сделку', { ...baseOpts, hasTopic: false })
    expect(r.blocking.some(b => b.code === 'no_topic')).toBe(true)
  })

  it('нет цели → блок', () => {
    const r = checkQuestionQuality('Расскажите про сложную сделку', { ...baseOpts, hasGoal: false })
    expect(r.blocking.some(b => b.code === 'no_goal')).toBe(true)
  })

  it('тема не активна → блок', () => {
    const r = checkQuestionQuality('Расскажите про сложную сделку', { ...baseOpts, topicActive: false })
    expect(r.blocking.some(b => b.code === 'topic_not_active')).toBe(true)
  })

  it('текст > 600 → блок', () => {
    const r = checkQuestionQuality('а'.repeat(601), baseOpts)
    expect(r.blocking.some(b => b.code === 'too_long_hard')).toBe(true)
  })

  it('валидный вопрос → без блоков, публикуется', () => {
    const r = checkQuestionQuality('Расскажите о самой сложной сделке, которую вы закрыли лично.', baseOpts)
    expect(r.blocking).toHaveLength(0)
    expect(canPublish(r)).toBe(true)
  })
})

describe('checkQuestionQuality — предупреждения', () => {
  it('закрытый вопрос (да/нет) → warning', () => {
    const r = checkQuestionQuality('Есть ли у вас опыт продаж?', baseOpts)
    expect(r.warnings.some(w => w.code === 'closed_question')).toBe(true)
    // предупреждение не блокирует
    expect(canPublish(r)).toBe(true)
  })

  it('нет expectedSignal → warning', () => {
    const r = checkQuestionQuality('Расскажите про кейс.', { ...baseOpts, expectedSignal: '' })
    expect(r.warnings.some(w => w.code === 'no_expected_signal')).toBe(true)
  })

  it('дубль по нормализованному тексту → warning', () => {
    const existing = new Set(['расскажите про сложную сделку'])
    const r = checkQuestionQuality('Расскажите про «сложную» сделку!', { ...baseOpts, existingNormalized: existing })
    expect(r.warnings.some(w => w.code === 'possible_duplicate')).toBe(true)
  })

  it('длина > 300 → soft warning', () => {
    const r = checkQuestionQuality('а'.repeat(350), baseOpts)
    expect(r.warnings.some(w => w.code === 'too_long_soft')).toBe(true)
  })
})

describe('checkAnchorQuality', () => {
  it('оценочная лексика → warning', () => {
    const r = checkAnchorQuality('Отличные коммуникативные навыки')
    expect(r.warnings.some(w => w.code === 'evaluative_anchor')).toBe(true)
  })

  it('поведенческий якорь → без warning', () => {
    const r = checkAnchorQuality('Называет конкретных стейкхолдеров и описывает, как согласовал решение')
    expect(r.warnings).toHaveLength(0)
  })

  it('пустой якорь → блок', () => {
    const r = checkAnchorQuality('')
    expect(r.blocking.some(b => b.code === 'empty')).toBe(true)
  })
})
