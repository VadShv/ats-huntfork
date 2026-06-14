/**
 * Единые проверки и константы для "закрытых" (placeholder) данных кандидата с hh.ru.
 *
 * История:
 *   • Старые кандидаты (sourcing-candidates/import.post.ts):
 *       firstName='Кандидат hh.ru', email='hh-<id>@noemail.local'
 *   • Новые кандидаты (sync.ts, importResume.ts — расширение):
 *       firstName='Кандидат', lastName='hh#<6 hex>',
 *       email='hh-<id>@no-email.huntfork.local'
 *
 * UI-кнопка "Открыть контакты hh.ru" и серверный мердж должны распознавать
 * ОБА варианта, иначе кнопка не показывается / контакты не перетираются.
 *
 * При импорте новых кандидатов ВСЕГДА используем «новые» константы ниже.
 */

/** Используется при создании нового placeholder-кандидата (имя). */
export const HH_PLACEHOLDER_FIRST_NAME = 'Кандидат'

/**
 * Шаблон email для placeholder-кандидатов. Формирует строку
 *   "hh-<resumeId>@no-email.huntfork.local"
 */
export function buildHhPlaceholderEmail(resumeId: string): string {
  return `hh-${resumeId}@no-email.huntfork.local`
}

/**
 * Распознаёт placeholder-имя кандидата с hh.ru (имя ещё не раскрыто).
 * Поддерживает обе исторические конвенции:
 *   • "Кандидат hh.ru" (старая)
 *   • "Кандидат" (новая, sync.ts/importResume.ts)
 *
 * Не путать с пустым first_name — здесь именно сравнение с placeholder.
 */
export function isHhPlaceholderFirstName(firstName: string | null | undefined): boolean {
  if (!firstName) return false
  const trimmed = firstName.trim()
  return trimmed === 'Кандидат hh.ru' || trimmed === 'Кандидат'
}

/**
 * Распознаёт placeholder-email кандидата с hh.ru (email ещё не раскрыт).
 * Соответствует ЛЮБОМУ из:
 *   • "hh-...@noemail.local" (старый, sourcing)
 *   • "hh-...@no-email.huntfork.local" (новый, sync/extension)
 *
 * Должен совпадать с логикой normalizeEmail в server/utils/dedup/normalize.ts
 * (которая возвращает null для таких email).
 */
export function isHhPlaceholderEmail(email: string | null | undefined): boolean {
  if (!email) return false
  const trimmed = email.trim().toLowerCase()
  if (!trimmed.startsWith('hh-')) return false
  return (
    trimmed.endsWith('@noemail.local')
    || trimmed.endsWith('@no-email.huntfork.local')
  )
}

/**
 * Кандидат с hh.ru ещё «закрыт» — то есть либо имя placeholder, либо email placeholder
 * (или и то, и другое). Это условие показа кнопки «Открыть контакты hh.ru».
 */
export function isHhContactsClosed(candidate: {
  firstName?: string | null
  email?: string | null
  hhResumeId?: string | null
}): boolean {
  if (!candidate.hhResumeId) return false
  return isHhPlaceholderFirstName(candidate.firstName) || isHhPlaceholderEmail(candidate.email)
}
