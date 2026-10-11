import { describe, it, expect } from 'vitest'
import { buildReferralBody, isReferralEventPayload, type ReferralEventPayload } from '../../shared/referrals/event'
import { groupTimeline } from '../../app/composables/useCommentGroups'

/**
 * «Передать коллеге» — docs/tz-discussion-referral.md §2.3.
 * Текст системной карточки (виден в поиске, полосе закреплённого и уведомлениях)
 * и её место в ленте (всегда отдельная единица, не склеивается в группу).
 */

function payload(over: Partial<ReferralEventPayload> = {}): ReferralEventPayload {
  return {
    event: 'referral',
    role: 'source',
    referralId: 'r1',
    status: 'pending',
    fromUserId: 'u1',
    fromUserName: 'Иван Петров',
    toUserId: 'u2',
    toUserName: 'Мария Сидорова',
    jobId: null,
    jobTitle: null,
    note: null,
    sourceApplicationId: 'a1',
    targetApplicationId: null,
    ...over,
  }
}

describe('buildReferralBody', () => {
  it('источник без вакансии и без комментария — кто кому, без статуса пока ожидает', () => {
    expect(buildReferralBody(payload())).toBe('Иван Петров передал(а) кандидата коллеге Мария Сидорова.')
  })

  it('источник с вакансией и комментарием', () => {
    const body = buildReferralBody(payload({ jobId: 'j1', jobTitle: 'Backend-разработчик', note: 'Сильный Go, смотрел на интервью', status: 'accepted' }))
    expect(body).toBe('Иван Петров передал(а) кандидата коллеге Мария Сидорова на вакансию «Backend-разработчик» (принят). Комментарий: Сильный Go, смотрел на интервью')
  })

  it('отклонённый реферал виден в тексте', () => {
    expect(buildReferralBody(payload({ status: 'declined' }))).toContain('(отклонён)')
  })

  it('целевой тред — «рекомендован» с вакансией', () => {
    const body = buildReferralBody(payload({ role: 'target', jobId: 'j1', jobTitle: 'QA', status: 'accepted', targetApplicationId: 'a2' }))
    expect(body).toBe('Кандидат рекомендован: Иван Петров → Мария Сидорова на вакансию «QA».')
  })
})

describe('isReferralEventPayload', () => {
  it('распознаёт только event = referral', () => {
    expect(isReferralEventPayload(payload())).toBe(true)
    expect(isReferralEventPayload({ event: 'stage' })).toBe(false)
    expect(isReferralEventPayload(null)).toBe(false)
    expect(isReferralEventPayload('referral')).toBe(false)
  })
})

describe('system_event в ленте', () => {
  const author = { id: 'u1', name: 'Иван', email: null, image: null, role: 'member' } as any
  const base = (id: string, kind: string | null, at: string) => ({
    type: 'comment' as const,
    comment: { id, kind, author, createdAt: at, parentCommentId: null, body: '', isInternal: true, payloadJson: null } as any,
  })

  it('карточка реферала не склеивается с соседними сообщениями того же автора', () => {
    const units = groupTimeline([
      base('c1', 'text', '2026-10-11T10:00:00Z'),
      base('c2', 'system_event', '2026-10-11T10:00:30Z'),
      base('c3', 'text', '2026-10-11T10:01:00Z'),
    ] as any, 'u1')
    expect(units.map(u => u.type)).toEqual(['group', 'standalone', 'group'])
    const standalone = units[1]!
    expect(standalone.type === 'standalone' && standalone.item.type === 'comment' && standalone.item.comment.kind).toBe('system_event')
  })
})
