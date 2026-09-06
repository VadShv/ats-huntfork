import { describe, it, expect } from 'vitest'
import { assembleCandidateQuestions, normalizeQuestion } from '../../server/utils/risk/buildCandidateQuestions'

describe('normalizeQuestion', () => {
  it('lowercases, collapses spaces and strips punctuation', () => {
    expect(normalizeQuestion('  Расскажите  про «PostgreSQL»? ')).toBe('расскажите про postgresql')
  })
})

describe('assembleCandidateQuestions', () => {
  const bank = [
    { id: 'b1', text: 'Опыт с PostgreSQL?', category: 'hard_skill' },
    { id: 'b2', text: 'Опыт с Redis?', category: 'hard_skill' },
    { id: 'b3', text: 'Опыт с Kafka?', category: 'hard_skill' },
    { id: 'b4', text: 'Почему уходите?', category: 'motivation' },
  ]
  const findings = [
    { issue: 'Разрыв в описании', question: 'Чем занимались в 2022?', listenFor: 'конкретика', severity: 'high' as const },
    { issue: 'Нет деталей', question: 'Опишите проект X', listenFor: 'метрики', severity: 'low' as const },
  ]

  it('puts risk-derived questions first, sorted by severity', () => {
    const r = assembleCandidateQuestions({ bank, findings, perBankCategory: 3 })
    expect(r[0]!.origin).toBe('risk_derived')
    expect(r[0]!.text).toBe('Чем занимались в 2022?') // high before low
    expect(r[0]!.category).toBe('verification')
    expect(r[1]!.text).toBe('Опишите проект X')
  })

  it('caps bank questions per category', () => {
    const r = assembleCandidateQuestions({ bank, findings: [], perBankCategory: 2 })
    const hard = r.filter(i => i.category === 'hard_skill')
    expect(hard.length).toBe(2) // capped at 2 of 3
    expect(r.some(i => i.category === 'motivation')).toBe(true)
  })

  it('perBankCategory=0 → only risk-derived', () => {
    const r = assembleCandidateQuestions({ bank, findings, perBankCategory: 0 })
    expect(r.every(i => i.origin === 'risk_derived')).toBe(true)
    expect(r.length).toBe(2)
  })

  it('dedups by normalized text across sources', () => {
    const r = assembleCandidateQuestions({
      bank: [{ id: 'b1', text: 'Чем занимались в 2022?', category: 'experience' }],
      findings,
      perBankCategory: 3,
    })
    const occurrences = r.filter(i => normalizeQuestion(i.text) === normalizeQuestion('Чем занимались в 2022?'))
    expect(occurrences.length).toBe(1)
    expect(occurrences[0]!.origin).toBe('risk_derived') // risk wins (added first)
  })

  it('skips findings without a question', () => {
    const r = assembleCandidateQuestions({
      bank: [],
      findings: [{ issue: 'x', question: '', severity: 'high' }],
      perBankCategory: 3,
    })
    expect(r.length).toBe(0)
  })

  it('assigns sequential displayOrder', () => {
    const r = assembleCandidateQuestions({ bank, findings, perBankCategory: 3 })
    expect(r.map(i => i.displayOrder)).toEqual(r.map((_, i) => i))
  })
})
