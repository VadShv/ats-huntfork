import { describe, expect, it } from 'vitest'
import {
  normalizeEmail,
  normalizeHhOwnerId,
  normalizeHhResumeId,
  normalizeLinkedinUrl,
  normalizePhone,
} from '../../server/utils/dedup/normalize'

// ─────────────────────────────────────────────────────────────────────────────
// normalizePhone — должен прийти к E.164 (+79991234567)
// ─────────────────────────────────────────────────────────────────────────────

describe('normalizePhone', () => {
  it('приводит российский номер с 8 к +7', () => {
    expect(normalizePhone('8 (999) 123-45-67')).toBe('+79991234567')
  })

  it('приводит номер с 7 без + к +7', () => {
    expect(normalizePhone('7 999 123 45 67')).toBe('+79991234567')
  })

  it('сохраняет уже валидный +7', () => {
    expect(normalizePhone('+79991234567')).toBe('+79991234567')
  })

  it('возвращает null для пустого', () => {
    expect(normalizePhone('')).toBeNull()
    expect(normalizePhone(null)).toBeNull()
    expect(normalizePhone(undefined)).toBeNull()
  })

  it('возвращает null для мусора', () => {
    expect(normalizePhone('abc')).toBeNull()
    expect(normalizePhone('123')).toBeNull()
  })

  it('убирает лишние пробелы вокруг', () => {
    expect(normalizePhone('  +7 999 123 45 67  ')).toBe('+79991234567')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// normalizeEmail — lowercase + trim, без gmail-плюс-aliasing
// ─────────────────────────────────────────────────────────────────────────────

describe('normalizeEmail', () => {
  it('приводит к нижнему регистру и тримит', () => {
    expect(normalizeEmail('  Vlad@Example.COM  ')).toBe('vlad@example.com')
  })

  it('возвращает null для hh-fallback', () => {
    expect(normalizeEmail('hh-12345@no-email.huntfork.local')).toBeNull()
  })

  it('возвращает null для невалидных', () => {
    expect(normalizeEmail('not-an-email')).toBeNull()
    expect(normalizeEmail('@example.com')).toBeNull()
    expect(normalizeEmail('user@')).toBeNull()
    expect(normalizeEmail('')).toBeNull()
    expect(normalizeEmail(null)).toBeNull()
  })

  it('сохраняет gmail-aliases как разные (НЕ нормализует +tag)', () => {
    // Намеренное поведение: gmail+aliases НЕ объединяются, чтобы не слить разных людей
    expect(normalizeEmail('user+tag@gmail.com')).toBe('user+tag@gmail.com')
    expect(normalizeEmail('user@gmail.com')).toBe('user@gmail.com')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// normalizeLinkedinUrl
// ─────────────────────────────────────────────────────────────────────────────

describe('normalizeLinkedinUrl', () => {
  it('извлекает slug из полного URL', () => {
    expect(normalizeLinkedinUrl('https://www.linkedin.com/in/vladimir-sherstnev/'))
      .toBe('vladimir-sherstnev')
  })

  it('игнорирует trailing slash', () => {
    expect(normalizeLinkedinUrl('linkedin.com/in/vshv/')).toBe('vshv')
  })

  it('игнорирует tracking-параметры', () => {
    expect(normalizeLinkedinUrl('linkedin.com/in/vshv?trk=public_profile'))
      .toBe('vshv')
  })

  it('обрабатывает ru.linkedin.com', () => {
    expect(normalizeLinkedinUrl('https://ru.linkedin.com/in/vshv'))
      .toBe('vshv')
  })

  it('возвращает null для не-LinkedIn URL', () => {
    expect(normalizeLinkedinUrl('https://hh.ru/resume/123')).toBeNull()
    expect(normalizeLinkedinUrl('')).toBeNull()
    expect(normalizeLinkedinUrl(null)).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// normalizeHhOwnerId / normalizeHhResumeId — простые тримы
// ─────────────────────────────────────────────────────────────────────────────

describe('normalizeHhOwnerId', () => {
  it('тримит и приводит число к строке', () => {
    expect(normalizeHhOwnerId('  12345  ')).toBe('12345')
    expect(normalizeHhOwnerId(12345)).toBe('12345')
  })

  it('возвращает null для пустых', () => {
    expect(normalizeHhOwnerId('')).toBeNull()
    expect(normalizeHhOwnerId(null)).toBeNull()
    expect(normalizeHhOwnerId(undefined)).toBeNull()
  })
})

describe('normalizeHhResumeId', () => {
  it('тримит строку', () => {
    expect(normalizeHhResumeId('  abc123  ')).toBe('abc123')
  })

  it('возвращает null для пустых', () => {
    expect(normalizeHhResumeId('')).toBeNull()
    expect(normalizeHhResumeId(null)).toBeNull()
  })
})
