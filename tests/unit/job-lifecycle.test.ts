import { describe, it, expect } from 'vitest'
import { computeJobLifecycleUpdate, type JobLifecycleState } from '../../server/utils/job-lifecycle'

const NOW = new Date('2026-03-01T12:00:00.000Z')

function state(overrides: Partial<JobLifecycleState> = {}): JobLifecycleState {
  return { status: 'draft', firstOpenedAt: null, reopenCount: 0, ...overrides }
}

describe('computeJobLifecycleUpdate', () => {
  it('no-op when status unchanged', () => {
    expect(computeJobLifecycleUpdate(state({ status: 'open' }), 'open', NOW)).toEqual({})
  })

  it('no-op when next status is undefined', () => {
    expect(computeJobLifecycleUpdate(state(), undefined, NOW)).toEqual({})
  })

  it('draft → open: sets openedAt, firstOpenedAt, clears closedAt, no reopen', () => {
    const patch = computeJobLifecycleUpdate(state({ status: 'draft' }), 'open', NOW)
    expect(patch.openedAt).toEqual(NOW)
    expect(patch.firstOpenedAt).toEqual(NOW)
    expect(patch.closedAt).toBeNull()
    expect(patch.reopenCount).toBeUndefined() // draft→open is not a reopen
  })

  it('open → closed: sets closedAt and closeReason', () => {
    const patch = computeJobLifecycleUpdate(state({ status: 'open', firstOpenedAt: NOW }), 'closed', NOW, 'cancelled')
    expect(patch.closedAt).toEqual(NOW)
    expect(patch.closeReason).toBe('cancelled')
    expect(patch.filledAt).toBeUndefined()
  })

  it('open → closed with reason "filled": also sets filledAt', () => {
    const patch = computeJobLifecycleUpdate(state({ status: 'open' }), 'closed', NOW, 'filled')
    expect(patch.closedAt).toEqual(NOW)
    expect(patch.closeReason).toBe('filled')
    expect(patch.filledAt).toEqual(NOW)
  })

  it('closed → open: reopen increments reopenCount, keeps firstOpenedAt', () => {
    const first = new Date('2026-01-01T00:00:00.000Z')
    const patch = computeJobLifecycleUpdate(
      state({ status: 'closed', firstOpenedAt: first, reopenCount: 0 }),
      'open',
      NOW,
    )
    expect(patch.openedAt).toEqual(NOW)
    expect(patch.closedAt).toBeNull()
    expect(patch.firstOpenedAt).toBeUndefined() // must not overwrite the original first open
    expect(patch.reopenCount).toBe(1)
  })

  it('archived → open: also counts as reopen', () => {
    const patch = computeJobLifecycleUpdate(
      state({ status: 'archived', firstOpenedAt: new Date('2026-01-01T00:00:00.000Z'), reopenCount: 2 }),
      'open',
      NOW,
    )
    expect(patch.reopenCount).toBe(3)
  })

  it('full cycle draft→open→closed→open produces reopenCount=1 and stable firstOpenedAt', () => {
    const t1 = new Date('2026-01-01T00:00:00.000Z')
    const t2 = new Date('2026-02-01T00:00:00.000Z')
    const t3 = new Date('2026-03-01T00:00:00.000Z')

    const p1 = computeJobLifecycleUpdate(state({ status: 'draft' }), 'open', t1)
    expect(p1.firstOpenedAt).toEqual(t1)
    expect(p1.reopenCount).toBeUndefined()

    const p2 = computeJobLifecycleUpdate(state({ status: 'open', firstOpenedAt: t1 }), 'closed', t2, 'filled')
    expect(p2.closedAt).toEqual(t2)
    expect(p2.filledAt).toEqual(t2)

    const p3 = computeJobLifecycleUpdate(state({ status: 'closed', firstOpenedAt: t1, reopenCount: 0 }), 'open', t3)
    expect(p3.reopenCount).toBe(1)
    expect(p3.firstOpenedAt).toBeUndefined()
    expect(p3.openedAt).toEqual(t3)
  })
})
