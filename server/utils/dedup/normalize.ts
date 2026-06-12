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

/**
 * Sprint 3.4 (P2.3): нормализуем Telegram handle/URL к чистому username (без @).
 * Примеры:
 *   @vladimir_pro     → vladimir_pro
 *   t.me/vladimir_pro → vladimir_pro
 *   https://t.me/vshv → vshv
 *   tg://resolve?domain=vshv → vshv
 */
export function normalizeTelegram(raw?: string | null): string | null {
  if (!raw) return null
  let s = raw.trim()
  if (!s) return null
  // tg://resolve?domain=X
  const tgMatch = s.match(/tg:\/\/resolve\?domain=([a-z0-9_]+)/i)
  if (tgMatch && tgMatch[1]) return tgMatch[1].toLowerCase()
  // t.me/X or https://t.me/X
  const meMatch = s.match(/t\.me\/([a-z0-9_]+)/i)
  if (meMatch && meMatch[1]) return meMatch[1].toLowerCase()
  // Просто @handle или handle
  s = s.replace(/^@/, '').toLowerCase()
  if (!/^[a-z0-9_]{3,32}$/.test(s)) return null
  return s
}

/**
 * Sprint 3.4 (P2.3): нормализуем GitHub URL/handle к username (без @, без слешей).
 * Примеры:
 *   https://github.com/vshv → vshv
 *   github.com/vshv/some-repo → vshv
 *   @vshv → vshv
 *   vshv → vshv
 */
export function normalizeGithub(raw?: string | null): string | null {
  if (!raw) return null
  let s = raw.trim()
  if (!s) return null
  // URL форма
  const m = s.match(/github\.com\/([a-z0-9][a-z0-9-]{0,38})/i)
  if (m && m[1]) return m[1].toLowerCase()
  // Просто @handle или handle
  s = s.replace(/^@/, '').toLowerCase()
  // GitHub: 1-39 символов, alphanumeric и дефисы, не начинается с дефиса
  if (!/^[a-z0-9][a-z0-9-]{0,38}$/.test(s)) return null
  return s
}
