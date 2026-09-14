import { describe, it, expect } from 'vitest'
import { trimTranscript, renderReportMarkdown, type InterviewReport } from '../../server/utils/ai/generateInterviewReport'

describe('trimTranscript (token-budget §5.8.3a)', () => {
  const questions = [
    { itemId: 'q1', text: 'Расскажите про PostgreSQL и оптимизацию запросов', listenFor: 'индексы', topicId: null },
  ]

  it('короткий транскрипт не режется', () => {
    const t = 'реплика про postgresql\nреплика про redis'
    const r = trimTranscript(t, questions, 10000)
    expect(r.truncated).toBe(false)
    expect(r.text).toBe(t)
  })

  it('длинный транскрипт режется, релевантные сегменты приоритетны', () => {
    const relevant = 'кандидат подробно рассказал про postgresql оптимизацию индексы запросы'
    const noise = Array.from({ length: 50 }, (_, i) => `нерелевантная реплика номер ${i} про погоду`).join('\n')
    const transcript = `${noise}\n${relevant}`
    const r = trimTranscript(transcript, questions, 200)
    expect(r.truncated).toBe(true)
    expect(r.text).toContain('postgresql') // релевантный сегмент попал
    expect(r.text.length).toBeLessThanOrEqual(200)
  })
})

describe('renderReportMarkdown (детерминированная сборка)', () => {
  const report: InterviewReport = {
    summary: 'Кандидат опытный',
    overallImpression: 'Сильный по бэкенду',
    sections: [{ topicId: 't1', title: 'Backend', summary: 'Хорошо разбирается', barsValue: '4' }],
    questionAnswers: [{
      itemId: 'q1', questionText: 'Опыт с PostgreSQL?', topicId: 't1', matched: true,
      answerText: '5 лет', evidence: ['я работал с postgres 5 лет'], barsValue: '4', barsRationale: 'детали', confidence: 'high',
    }],
    risksVerified: [{ issue: 'Разрыв в стаже', verdict: 'refuted', evidence: ['был в отпуске'] }],
    recommendedNextSteps: ['Техническое интервью'],
  }

  it('собирает markdown со всеми секциями', () => {
    const md = renderReportMarkdown(report)
    expect(md).toContain('# Отчёт по интервью')
    expect(md).toContain('## Резюме')
    expect(md).toContain('Кандидат опытный')
    expect(md).toContain('### Backend (оценка: 4)')
    expect(md).toContain('> я работал с postgres 5 лет')
    expect(md).toContain('**refuted**')
    expect(md).toContain('Техническое интервью')
  })

  it('детерминизм: одинаковый вход → одинаковый выход', () => {
    expect(renderReportMarkdown(report)).toBe(renderReportMarkdown(report))
  })
})
