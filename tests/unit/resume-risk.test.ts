import { describe, it, expect } from 'vitest'
import { parseDate, monthsBetween, computeJobHopping, DEFAULT_JOB_HOPPING_POLICY } from '../../server/utils/risk/timeline'
import { aggregateRisk } from '../../server/utils/ai/assessRisk'

// Fixed "now" for deterministic tests: 2025-01-01.
const NOW = new Date('2025-01-01T00:00:00Z').getTime()

describe('parseDate', () => {
  it('parses YYYY-MM and YYYY-MM-DD', () => {
    expect(parseDate('2021-06', NOW)).toBe(new Date(2021, 5).getTime())
    expect(parseDate('2021-06-15', NOW)).toBe(new Date(2021, 5).getTime())
  })
  it('parses «Mon YYYY» in RU and EN', () => {
    expect(parseDate('мар 2022', NOW)).toBe(new Date(2022, 2).getTime())
    expect(parseDate('Mar 2022', NOW)).toBe(new Date(2022, 2).getTime())
  })
  it('parses bare YYYY', () => {
    expect(parseDate('2020', NOW)).toBe(new Date(2020, 0).getTime())
  })
  it('treats «настоящее время» as now', () => {
    expect(parseDate('по настоящее время', NOW)).toBe(NOW)
    expect(parseDate('present', NOW)).toBe(NOW)
  })
  it('returns null for junk / empty', () => {
    expect(parseDate('', NOW)).toBeNull()
    expect(parseDate(null, NOW)).toBeNull()
    expect(parseDate('когда-то', NOW)).toBeNull()
  })
})

describe('monthsBetween', () => {
  it('approximates months between two dates', () => {
    const a = new Date(2020, 0).getTime()
    const b = new Date(2021, 0).getTime()
    expect(Math.round(monthsBetween(a, b))).toBe(12)
  })
})

describe('computeJobHopping', () => {
  it('returns empty facts for no experience', () => {
    const r = computeJobHopping([], NOW)
    expect(r.hasStructuredDates).toBe(false)
    expect(r.jobHoppingLevel).toBe('low')
    expect(r.jobsCount).toBe(0)
  })

  it('marks a stable long-tenure candidate as low', () => {
    const r = computeJobHopping([
      { company: 'A', start: '2016-01', end: '2020-01' }, // 48 мес
      { company: 'B', start: '2020-01', end: '2025-01' }, // 60 мес
    ], NOW)
    expect(r.jobsCount).toBe(2)
    expect(r.hasStructuredDates).toBe(true)
    expect(r.shortStints.length).toBe(0)
    expect(r.jobHoppingLevel).toBe('low')
    expect(r.jobHoppingScore).toBe(0)
  })

  it('flags frequent short stints as high', () => {
    const r = computeJobHopping([
      { company: 'A', start: '2023-01', end: '2023-06' }, // 5
      { company: 'B', start: '2023-07', end: '2024-01' }, // 6
      { company: 'C', start: '2024-02', end: '2024-08' }, // 6
      { company: 'D', start: '2024-09', end: '2025-01' }, // 4
    ], NOW)
    expect(r.jobsCount).toBe(4)
    expect(r.shortStints.length).toBe(4)
    expect(r.shortStintRatio).toBe(1)
    expect(r.jobHoppingLevel).toBe('high')
    expect(r.jobHoppingScore).toBeGreaterThanOrEqual(DEFAULT_JOB_HOPPING_POLICY.highScore)
  })

  it('does not score job-hopping for a single job', () => {
    const r = computeJobHopping([{ company: 'A', start: '2024-06', end: '2025-01' }], NOW)
    expect(r.jobsCount).toBe(1)
    expect(r.jobHoppingScore).toBe(0)
    expect(r.jobHoppingLevel).toBe('low')
  })

  it('handles «present» end via injected now', () => {
    const r = computeJobHopping([
      { company: 'A', start: '2018-01', end: '2022-01' },
      { company: 'B', start: '2022-01', end: 'по настоящее время' },
    ], NOW)
    expect(r.jobsCount).toBe(2)
    expect(r.totalMonths).toBeGreaterThan(80)
  })

  it('ignores entries with unparseable start date', () => {
    const r = computeJobHopping([
      { company: 'A', start: 'неизвестно', end: '2020-01' },
      { company: 'B', start: '2020-01', end: '2025-01' },
    ], NOW)
    expect(r.jobsCount).toBe(1)
  })
})

describe('aggregateRisk (cap)', () => {
  it('caps linguistic-only high to medium', () => {
    const findings = [
      { severity: 'high' as const, confidence: 'linguistic' as const },
      { severity: 'high' as const, confidence: 'linguistic' as const },
      { severity: 'high' as const, confidence: 'linguistic' as const },
    ]
    const r = aggregateRisk(findings, { jobHoppingLevel: 'low', jobHoppingScore: 0 })
    expect(r.isCapped).toBe(true)
    expect(r.overallRisk).toBe('medium')
  })

  it('allows high when hard-evidence present', () => {
    const findings = [
      { severity: 'high' as const, confidence: 'document' as const },
      { severity: 'high' as const, confidence: 'linguistic' as const },
    ]
    const r = aggregateRisk(findings, { jobHoppingLevel: 'low', jobHoppingScore: 0 })
    expect(r.isCapped).toBe(false)
    expect(r.overallRisk).toBe('high')
  })

  it('allows high when job-hopping is high even without findings', () => {
    const r = aggregateRisk([], { jobHoppingLevel: 'high', jobHoppingScore: 80 })
    expect(r.overallRisk).toBe('high')
    expect(r.isCapped).toBe(false)
  })

  it('returns low for no findings and low job-hopping', () => {
    const r = aggregateRisk([], { jobHoppingLevel: 'low', jobHoppingScore: 0 })
    expect(r.overallRisk).toBe('low')
    expect(r.overallScore).toBe(0)
  })

  it('respects capLinguisticToMedium=false', () => {
    const findings = [
      { severity: 'high' as const, confidence: 'linguistic' as const },
      { severity: 'high' as const, confidence: 'linguistic' as const },
      { severity: 'high' as const, confidence: 'linguistic' as const },
    ]
    const r = aggregateRisk(findings, { jobHoppingLevel: 'low', jobHoppingScore: 0 }, { capLinguisticToMedium: false })
    expect(r.overallRisk).toBe('high')
    expect(r.isCapped).toBe(false)
  })
})
