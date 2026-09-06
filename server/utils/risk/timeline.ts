/**
 * Детерминированный слой риск-анализа (Этап 3): ЧАСТОТА СМЕН МЕСТ РАБОТЫ.
 *
 * Всё, что связано с датами, считает КОД — не LLM (модели ненадёжны в
 * арифметике дат). В MVP анализируем ТОЛЬКО частоту смен работ (job-hopping):
 * число мест, средний/медианный срок, короткие места, jobHoppingScore/Level.
 * Разрывы/пересечения/инфляция стажа — сознательно НЕ считаем (задел на потом).
 *
 * Парсер дат `parseDate` и `monthsBetween` портированы из рабочего движка
 * расширения (extension/.../useVerification.ts:243-274) — устойчивы к форматам
 * YYYY-MM(-DD), «Mon YYYY», YYYY и «настоящее время» (RU+EN).
 */

const MONTH_MS = 1000 * 60 * 60 * 24 * 30.4375

const RU_MONTHS: Record<string, number> = {
  янв: 0, фев: 1, мар: 2, апр: 3, май: 4, июн: 5,
  июл: 6, авг: 7, сен: 8, окт: 9, ноя: 10, дек: 11,
  января: 0, февраля: 1, марта: 2, апреля: 3, мая: 4, июня: 5,
  июля: 6, августа: 7, сентября: 8, октября: 9, ноября: 10, декабря: 11,
}

function enMonth(s: string): number | null {
  const M: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  }
  return M[s.toLowerCase().slice(0, 3)] ?? null
}

/**
 * Устойчивый парсер дат резюме. Возвращает ms или null.
 * `now` инъектируется (серверный CURRENT_DATE) — для «настоящее время».
 */
export function parseDate(raw: string | null | undefined, now: number = Date.now()): number | null {
  if (raw == null || raw === '') return null
  const s = String(raw).trim().toLowerCase()
  if (s === '' || s === 'настоящее' || s === 'по настоящее время' || s === 'now' || s === 'текущее' || s === 'present') {
    return now
  }
  // YYYY-MM / YYYY-MM-DD
  let m = s.match(/^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/)
  if (m) return new Date(+m[1]!, +m[2]! - 1).getTime()
  // Mon YYYY / Month YYYY
  m = s.match(/^([a-zа-я]+)\.?\s+(\d{4})$/i)
  if (m) {
    const mon = RU_MONTHS[m[1]!.toLowerCase()] ?? enMonth(m[1]!)
    if (mon != null) return new Date(+m[2]!, mon).getTime()
  }
  // YYYY
  m = s.match(/^(\d{4})$/)
  if (m) return new Date(+m[1]!, 0).getTime()
  return null
}

export function monthsBetween(a: number, b: number): number {
  return Math.abs(b - a) / MONTH_MS
}

export interface ExperienceInput {
  company?: string | null
  position?: string | null
  start?: string | null
  end?: string | null
}

export interface JobHoppingPolicy {
  /** Порог «короткого» места, мес (по умолчанию 12). */
  shortStintMonths: number
  /** Порог score для medium (по умолчанию 40). */
  mediumScore: number
  /** Порог score для high (по умолчанию 65). */
  highScore: number
}

export const DEFAULT_JOB_HOPPING_POLICY: JobHoppingPolicy = {
  shortStintMonths: 12,
  mediumScore: 40,
  highScore: 65,
}

export interface TenureFacts {
  hasStructuredDates: boolean
  jobsCount: number
  totalMonths: number
  avgTenureMonths: number
  medianTenureMonths: number
  shortStints: Array<{ company: string, months: number }>
  shortStintRatio: number
  jobHoppingScore: number
  jobHoppingLevel: 'low' | 'medium' | 'high'
}

function median(nums: number[]): number {
  if (!nums.length) return 0
  const s = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2)
}

/**
 * Считает частоту смен работ по структурированному опыту.
 *
 * Формула jobHoppingScore (0..100) — прозрачная и тестируемая:
 *   score = 55 * shortStintRatio + tenurePenalty
 *   где tenurePenalty растёт, когда средний срок < 24 мес:
 *     avg >= 24 → 0; avg <= 6 → 45; между — линейно.
 * Только для >= 2 мест (по одному месту частоту смен считать бессмысленно).
 */
export function computeJobHopping(
  experience: ExperienceInput[],
  now: number = Date.now(),
  policy: JobHoppingPolicy = DEFAULT_JOB_HOPPING_POLICY,
): TenureFacts {
  const empty: TenureFacts = {
    hasStructuredDates: false,
    jobsCount: 0,
    totalMonths: 0,
    avgTenureMonths: 0,
    medianTenureMonths: 0,
    shortStints: [],
    shortStintRatio: 0,
    jobHoppingScore: 0,
    jobHoppingLevel: 'low',
  }
  if (!Array.isArray(experience) || experience.length === 0) return empty

  // Оставляем только записи с распознанной датой начала.
  const jobs = experience
    .map((e, i) => {
      const start = parseDate(e.start, now)
      if (start == null) return null
      const end = parseDate(e.end, now) ?? now
      const months = Math.max(0, Math.round(monthsBetween(start, end)))
      return { company: e.company?.trim() || `Компания ${i + 1}`, months }
    })
    .filter((x): x is { company: string, months: number } => x !== null)

  if (jobs.length === 0) return empty

  const jobsCount = jobs.length
  const durations = jobs.map(j => j.months)
  const totalMonths = durations.reduce((s, m) => s + m, 0)
  const avgTenureMonths = Math.round(totalMonths / jobsCount)
  const medianTenureMonths = median(durations)
  const shortStints = jobs.filter(j => j.months > 0 && j.months < policy.shortStintMonths)
  const shortStintRatio = jobsCount ? shortStints.length / jobsCount : 0

  // Частоту смен считаем только при >= 2 местах.
  let jobHoppingScore = 0
  if (jobsCount >= 2) {
    const tenurePenalty
      = avgTenureMonths >= 24
        ? 0
        : avgTenureMonths <= 6
          ? 45
          : Math.round(45 * (24 - avgTenureMonths) / 18)
    jobHoppingScore = Math.min(100, Math.round(55 * shortStintRatio + tenurePenalty))
  }

  const jobHoppingLevel: TenureFacts['jobHoppingLevel']
    = jobHoppingScore >= policy.highScore ? 'high'
      : jobHoppingScore >= policy.mediumScore ? 'medium'
        : 'low'

  return {
    hasStructuredDates: true,
    jobsCount,
    totalMonths,
    avgTenureMonths,
    medianTenureMonths,
    shortStints: shortStints.map(s => ({ company: s.company, months: s.months })),
    shortStintRatio: Math.round(shortStintRatio * 100) / 100,
    jobHoppingScore,
    jobHoppingLevel,
  }
}
