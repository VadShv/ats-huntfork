import { describe, it, expect } from 'vitest'
import {
  INTERNAL_VISIBLE_ROLES,
  EXTERNAL_AUDIENCE_ROLES,
  canSeeInternalRole,
  isExternalAudienceRole,
} from '../../shared/access/discussion'
import { canSeeInternal } from '../../server/utils/comments/visibility'

describe('shared/access/discussion — единые правила видимости внутренних сообщений', () => {
  it('роли команды видят внутренние сообщения', () => {
    for (const role of ['owner', 'admin', 'member', 'recruiter', 'lead_recruiter']) {
      expect(canSeeInternalRole(role)).toBe(true)
    }
  })

  it('заказчик и внешний рекрутер не видят внутренние сообщения', () => {
    expect(canSeeInternalRole('hiring_manager')).toBe(false)
    expect(canSeeInternalRole('external_recruiter')).toBe(false)
    expect(canSeeInternalRole(null)).toBe(false)
    expect(canSeeInternalRole(undefined)).toBe(false)
    expect(canSeeInternalRole('')).toBe(false)
  })

  it('наборы ролей не пересекаются', () => {
    for (const role of EXTERNAL_AUDIENCE_ROLES) {
      expect(INTERNAL_VISIBLE_ROLES.has(role)).toBe(false)
      expect(isExternalAudienceRole(role)).toBe(true)
    }
  })

  it('серверная canSeeInternal делегирует общему набору (клиент и сервер не расходятся)', () => {
    for (const role of ['owner', 'admin', 'member', 'recruiter', 'lead_recruiter', 'hiring_manager', 'external_recruiter', 'unknown']) {
      expect(canSeeInternal(role)).toBe(canSeeInternalRole(role))
    }
  })
})
