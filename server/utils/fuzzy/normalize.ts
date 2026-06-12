/**
 * Нормализация ФИО для fuzzy-сравнения: lowercase, убираем лишние пробелы,
 * заменяем ё→е, приводим латиницу к кириллице (если очевидно).
 */
const CYR_TRANSLIT: Record<string, string> = {
  a: 'а', b: 'б', v: 'в', g: 'г', d: 'д', e: 'е', z: 'з', i: 'и', y: 'й',
  k: 'к', l: 'л', m: 'м', n: 'н', o: 'о', p: 'п', r: 'р', s: 'с', t: 'т',
  u: 'у', f: 'ф', h: 'х', c: 'ц',
}

export function normalizeName(input: string | null | undefined): string {
  if (!input) return ''
  let s = input.trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ')
  // Если строка целиком латиница и не содержит цифр — пробуем транслит в кириллицу
  if (/^[a-z\s'-]+$/.test(s)) {
    s = s.split('').map(ch => CYR_TRANSLIT[ch] ?? ch).join('')
  }
  // Убираем дефисы и апострофы для базового сравнения
  return s.replace(/[''\-]+/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Нормализация города: убирает «г.», «город», скобки с регионом.
 *
 * Важно: JS \b не работает с кириллицей, поэтому явные якоря
 * по началу/пробелу вместо \b.
 */
export function normalizeCity(input: string | null | undefined): string {
  if (!input) return ''
  return input
    .toLowerCase()
    .replace(/ё/g, 'е')
    // «г.» / «г » / «г» в начале или после пробела (но НЕ внутри слов, напр. «нижний новгород»)
    .replace(/(^|\s)г\.\s*/g, '$1')
    .replace(/(^|\s)г\s+/g, '$1')
    // «город» НА НАЧАЛЕ или после пробела, но перед пробелом (чтобы не съесть «Новгород»)
    .replace(/(^|\s)город\s+/g, '$1')
    .replace(/\(.*?\)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Levenshtein distance с нормализацией к диапазону 0..100 (100 = идентично).
 */
export function levenshteinSimilarity(a: string, b: string): number {
  if (!a && !b) return 100
  if (!a || !b) return 0
  if (a === b) return 100

  const m = a.length
  const n = b.length
  if (Math.abs(m - n) / Math.max(m, n) > 0.5) return 0 // быстрый отказ при сильно разной длине

  const prev = new Array(n + 1).fill(0)
  const curr = new Array(n + 1).fill(0)
  for (let j = 0; j <= n; j++) prev[j] = j

  for (let i = 1; i <= m; i++) {
    curr[0] = i
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j]
  }
  const dist = prev[n]
  const maxLen = Math.max(m, n)
  return Math.round((1 - dist / maxLen) * 100)
}

/**
 * Сходство двух ФИО (целиком): сначала нормализуем оба, потом сравниваем
 * множества токенов, чтобы порядок «Иван Петров» / «Петров Иван» дал 100.
 */
export function nameSimilarity(
  fullA: string | null | undefined,
  fullB: string | null | undefined,
): number {
  const a = normalizeName(fullA)
  const b = normalizeName(fullB)
  if (!a || !b) return 0
  if (a === b) return 100

  const tokensA = a.split(' ').filter(Boolean).sort()
  const tokensB = b.split(' ').filter(Boolean).sort()
  if (tokensA.join(' ') === tokensB.join(' ')) return 100

  // Если у обоих есть две доминирующие части (имя + фамилия) — сравним их пары
  if (tokensA.length >= 2 && tokensB.length >= 2) {
    // Берём 2 самых длинных токена (обычно имя+фамилия), сравниваем сортированно
    const topA = tokensA.slice().sort((x, y) => y.length - x.length).slice(0, 2).sort()
    const topB = tokensB.slice().sort((x, y) => y.length - x.length).slice(0, 2).sort()
    const sims = topA.map((tA, i) => levenshteinSimilarity(tA, topB[i] ?? ''))
    return Math.round(sims.reduce((a, b) => a + b, 0) / sims.length)
  }

  return levenshteinSimilarity(a.replace(/\s+/g, ''), b.replace(/\s+/g, ''))
}

/**
 * Сравнение городов: нормализуем и сравниваем Levenshtein.
 * Москва и Санкт-Петербург не должны давать ложного совпадения.
 */
export function citySimilarity(
  a: string | null | undefined,
  b: string | null | undefined,
): number {
  const nA = normalizeCity(a)
  const nB = normalizeCity(b)
  if (!nA || !nB) return 0
  return levenshteinSimilarity(nA, nB)
}

/**
 * Сравнение дат рождения. Полностью совпадают — 100, иначе 0.
 * (Никакой fuzzy-логики на DOB — это сильный сигнал, либо равны, либо нет.)
 */
export function dobSimilarity(a: Date | string | null | undefined, b: Date | string | null | undefined): number {
  if (!a || !b) return 0
  const dA = typeof a === 'string' ? a.slice(0, 10) : a.toISOString().slice(0, 10)
  const dB = typeof b === 'string' ? b.slice(0, 10) : b.toISOString().slice(0, 10)
  return dA === dB ? 100 : 0
}

/**
 * Нормализация названия организации/работодателя.
 * Убираем правовые формы (ООО, ПАО, ЗАО, OJSC, LLC, Ltd, Inc, Corp, GmbH),
 * кавычки, лишние пробелы.
 */
export function normalizeOrg(input: string | null | undefined): string {
  if (!input) return ''
  let s = input.toLowerCase().replace(/ё/g, 'е').trim()
  // Кавычки и спецсимволы приводим к пробелам
  s = s.replace(/[«»"'`]+/g, ' ')
  // Правовые формы — \b не работает для кириллицы в JS,
  // используем явные lookahead/lookbehind по пробелам/границам.
  s = s.replace(/(^|\s)(ооо|оао|зао|пао|нпп|нпо|ип|ао|ано|ук|нко|фгуп|муп|тоо)(?=\s|$)/g, '$1')
  s = s.replace(/(^|\s)(llc|ltd|inc|corp|corporation|gmbh|sa|ag|plc|co|company|holding)(?=\s|\.|$)\.?/g, '$1')
  // Дублирующиеся знаки и пробелы
  s = s.replace(/[.,;:]+/g, ' ').replace(/\s+/g, ' ').trim()
  return s
}

/**
 * Сравнение двух наборов работодателей/учебных заведений (массивы названий).
 * Возвращает 100 если хотя бы одна пара совпадает на ≥85% (Jaccard-like).
 * Возвращает 0 если хотя бы один из массивов пуст.
 *
 * Используется как 4-й сигнал в fuzzy-матчинге (Sprint 3.2).
 */
export function orgListSimilarity(
  a: Array<string | null | undefined> | null | undefined,
  b: Array<string | null | undefined> | null | undefined,
): number {
  if (!a || !b || a.length === 0 || b.length === 0) return 0
  const setA = a.map(normalizeOrg).filter(Boolean)
  const setB = b.map(normalizeOrg).filter(Boolean)
  if (setA.length === 0 || setB.length === 0) return 0

  let bestPair = 0
  for (const x of setA) {
    for (const y of setB) {
      const sim = levenshteinSimilarity(x, y)
      if (sim > bestPair) bestPair = sim
    }
  }
  // Хотя бы одна сильная пара — даём 100.
  // Слабые пары (≤60) не считаем сигналом — слишком много ложных совпадений.
  if (bestPair >= 85) return 100
  if (bestPair >= 70) return Math.round(bestPair) // частичное совпадение
  return 0
}

