import { parsePhoneNumberFromString } from 'libphonenumber-js/max'

/**
 * Нормализуем телефон к E.164 (+79991234567).
 * Поддерживаются российские номера в любых форматах (с +7, 7, 8, без кода страны).
 * Возвращает null если номер невалидный — такой не используется для дедупликации.
 */
export function normalizePhone(raw?: string | null): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  // Попробуем с дефолтной страной RU, если номер без префикса
  const parsed = parsePhoneNumberFromString(trimmed, 'RU')
  if (!parsed?.isValid()) return null
  return parsed.format('E.164') // +79991234567
}

/**
 * Нормализуем email: lowercase + trim.
 * Никаких трюков с gmail-aliases — это рискованно (можно ложно слить разных людей).
 * Возвращаем null для пустых или явно мусорных значений (fallback hh-...@no-email).
 */
export function normalizeEmail(raw?: string | null): string | null {
  if (!raw) return null
  const trimmed = raw.trim().toLowerCase()
  if (!trimmed) return null
  // hh-fallback не используется для дедупликации (он сам по себе — id резюме)
  if (trimmed.endsWith('@no-email.huntfork.local')) return null
  // базовая sanity-проверка
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return null
  return trimmed
}

/**
 * Нормализуем LinkedIn URL к slug-у профиля.
 * Примеры:
 *   https://www.linkedin.com/in/vladimir-sherstnev/  → vladimir-sherstnev
 *   linkedin.com/in/vshv?trk=...                     → vshv
 *   https://ru.linkedin.com/in/vshv                  → vshv
 */
export function normalizeLinkedinUrl(raw?: string | null): string | null {
  if (!raw) return null
  const m = raw.trim().toLowerCase().match(/linkedin\.com\/in\/([a-z0-9-_%]+)/i)
  if (!m || !m[1]) return null
  return decodeURIComponent(m[1]).replace(/\/$/, '') || null
}

/**
 * Нормализуем hh.ru owner.id — просто строка, тримим и приводим к нижнему регистру.
 */
export function normalizeHhOwnerId(raw?: string | number | null): string | null {
  if (raw == null) return null
  const s = String(raw).trim()
  return s || null
}

/**
 * Нормализуем hh resume_id — стабильная строка-идентификатор конкретного резюме.
 */
export function normalizeHhResumeId(raw?: string | null): string | null {
  if (!raw) return null
  const s = raw.trim()
  return s || null
}
