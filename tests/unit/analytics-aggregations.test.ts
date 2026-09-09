import { describe, it, expect } from 'vitest'
import {
  agingBucketIndex, AGING_BUCKET_LABELS, noShowRate, linkCtr, isFullyFilled, hireRate, computeTimeToFill,
} from '../../server/utils/analytics/aggregations'

const OPENED = new Date('2026-01-01T00:00:00.000Z')
const CLOSED = new Date('2026-01-11T00:00:00.000Z') // +10 дней
const LAST_HIRE = new Date('2026-01-16T00:00:00.000Z') // +15 дней

describe('computeTimeToFill', () => {
  it('null when not opened', () => {
    expect(computeTimeToFill({ openedAt: null, closedAt: CLOSED, lastHiredAt: LAST_HIRE, headcount: 1, status: 'closed', totalHires: 1 })).toBeNull()
  })
  it('null when open and not fully filled', () => {
    expect(computeTimeToFill({ openedAt: OPENED, closedAt: null, lastHiredAt: null, headcount: 1, status: 'open', totalHires: 0 })).toBeNull()
  })
  it('headcount=1 closed: uses closedAt', () => {
    expect(computeTimeToFill({ openedAt: OPENED, closedAt: CLOSED, lastHiredAt: LAST_HIRE, headcount: 1, status: 'closed', totalHires: 1 })).toBe(10)
  })
  it('headcount=1 filled-by-hires (not closed): uses closedAt if present else lastHire', () => {
    expect(computeTimeToFill({ openedAt: OPENED, closedAt: null, lastHiredAt: LAST_HIRE, headcount: 1, status: 'open', totalHires: 1 })).toBe(15)
  })
  it('multi-hire fully filled: uses lastHiredAt (not closedAt)', () => {
    expect(computeTimeToFill({ openedAt: OPENED, closedAt: CLOSED, lastHiredAt: LAST_HIRE, headcount: 3, status: 'open', totalHires: 3 })).toBe(15)
  })
  it('multi-hire not fully filled: null', () => {
    expect(computeTimeToFill({ openedAt: OPENED, closedAt: null, lastHiredAt: LAST_HIRE, headcount: 3, status: 'open', totalHires: 2 })).toBeNull()
  })
  it('multi-hire closed but no lastHiredAt: null (endMoment missing)', () => {
    expect(computeTimeToFill({ openedAt: OPENED, closedAt: CLOSED, lastHiredAt: null, headcount: 3, status: 'closed', totalHires: 0 })).toBeNull()
  })
})

describe('agingBucketIndex', () => {
  it('maps days to correct bucket', () => {
    expect(agingBucketIndex(0)).toBe(0)
    expect(agingBucketIndex(7)).toBe(0)
    expect(agingBucketIndex(8)).toBe(1)
    expect(agingBucketIndex(14)).toBe(1)
    expect(agingBucketIndex(15)).toBe(2)
    expect(agingBucketIndex(30)).toBe(2)
    expect(agingBucketIndex(31)).toBe(3)
    expect(agingBucketIndex(60)).toBe(3)
    expect(agingBucketIndex(61)).toBe(4)
    expect(agingBucketIndex(365)).toBe(4)
  })
  it('has 5 labels matching buckets', () => {
    expect(AGING_BUCKET_LABELS).toHaveLength(5)
  })
})

describe('noShowRate', () => {
  it('computes rate', () => {
    expect(noShowRate(8, 2)).toBe(0.2)
    expect(noShowRate(0, 0)).toBeNull()
    expect(noShowRate(10, 0)).toBe(0)
    expect(noShowRate(0, 3)).toBe(1)
  })
})

describe('linkCtr', () => {
  it('computes CTR, null on zero clicks', () => {
    expect(linkCtr(100, 25)).toBe(0.25)
    expect(linkCtr(0, 0)).toBeNull()
    expect(linkCtr(3, 1)).toBe(0.333)
  })
})

describe('isFullyFilled', () => {
  it('true when hires >= headcount', () => {
    expect(isFullyFilled(1, 1)).toBe(true)
    expect(isFullyFilled(0, 1)).toBe(false)
    expect(isFullyFilled(2, 3)).toBe(false)
    expect(isFullyFilled(3, 3)).toBe(true)
    expect(isFullyFilled(5, 3)).toBe(true)
  })
  it('treats headcount<1 as 1', () => {
    expect(isFullyFilled(1, 0)).toBe(true)
  })
})

describe('hireRate', () => {
  it('computes hire rate', () => {
    expect(hireRate(100, 5)).toBe(0.05)
    expect(hireRate(0, 0)).toBeNull()
  })
})
