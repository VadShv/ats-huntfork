/**
 * Единая логика ключей критериев скоринга.
 * Используется страницей создания вакансии (dashboard/jobs/new.vue) и
 * страницей редактирования критериев (dashboard/jobs/[id]/ai-analysis.vue).
 *
 * Ключ критерия — внутренний идентификатор для LLM и БД. Пользователь его
 * не видит: вводит только человеко-читаемое имя.
 *
 * ТРЕБОВАНИЯ:
 * — Серверная схема требует regex ^[a-z][a-z0-9_]*$ (см. server/utils/schemas/scoring.ts).
 * — Русские имена должны транслитерироваться в осмысленный ключ.
 * — Имена без букв («123») должны получать понятный fallback (criterion_1, criterion_2…),
 *   а не мусорный `c_<time36>` — LLM плохо работает с бессмысленными ключами.
 * — Коллизии решаются автосуффиксом `_2 / _3 / …`.
 */

const RU_TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e',
  ж: 'zh', з: 'z', и: 'i', й: 'i', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u',
  ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
}

/**
 * Валидация человеко-читаемого имени критерия.
 * Отсекает мусор типа «123», «!!!», «   » — до генерации ключа.
 *
 * Правила:
 * — минимум 3 непробельных символа,
 * — хотя бы одна буква (латиница или кириллица).
 */
export function validateCriterionName(name: string): { ok: true } | { ok: false; reason: string } {
  const trimmed = (name || '').trim()
  if (trimmed.length === 0) {
    return { ok: false, reason: 'Введите название критерия' }
  }
  if (trimmed.length < 3) {
    return { ok: false, reason: 'Название критерия слишком короткое (минимум 3 символа)' }
  }
  if (!/[a-zа-яё]/i.test(trimmed)) {
    return { ok: false, reason: 'Название критерия должно содержать буквы' }
  }
  return { ok: true }
}

/**
 * Транслитерирует имя критерия в валидный внутренний ключ.
 *
 * @param name Человеко-читаемое имя, введённое пользователем.
 * @param existingKeys Список уже занятых ключей (для автосуффикса).
 * @returns Ключ вида `lokatsiya_v_moskve`, `criterion_3`, `format_raboty_2`.
 */
export function slugifyKeyRu(name: string, existingKeys: string[] = []): string {
  const base = (name || '')
    .toLowerCase()
    .trim()
    .split('')
    .map((c) => RU_TRANSLIT[c] ?? c)
    .join('')
    .replace(/[^a-z0-9_\s-]/g, '')
    .replace(/[\s-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60)

  let cand: string
  if (/^[a-z][a-z0-9_]*$/.test(base)) {
    // Идеальный случай — валидный ключ прямо из имени.
    cand = base
  }
  else if (/^[0-9]/.test(base) && /^[a-z0-9_]+$/.test(base)) {
    // Имя начинается с цифры («123 доступа», «5g_experience»), но состоит из
    // допустимых символов — префиксуем `c_`, чтобы получить валидный ключ.
    cand = `c_${base}`.slice(0, 60)
  }
  else {
    // Имя не дало никаких валидных символов (например, только эмодзи или пунктуация).
    // Используем понятный порядковый fallback вместо мусорного `c_<time36>`.
    let n = existingKeys.length + 1
    while (existingKeys.includes(`criterion_${n}`)) n++
    cand = `criterion_${n}`
  }

  // Автосуффикс при коллизии — не блокируем пользователя ошибкой.
  if (existingKeys.includes(cand)) {
    let i = 2
    while (existingKeys.includes(`${cand}_${i}`)) i++
    cand = `${cand}_${i}`
  }

  return cand
}
