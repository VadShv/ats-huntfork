/**
 * Центр аналитики: чистые функции-агрегаторы (тестируемы без БД).
 */

/** Бакет возраста вакансии (дней) для heatmap. */
export function agingBucketIndex(days: number): number {
  if (days <= 7) return 0
  if (days <= 14) return 1
  if (days <= 30) return 2
  if (days <= 60) return 3
  return 4
}

export const AGING_BUCKET_LABELS = ['0-7', '8-14', '15-30', '31-60', '60+']

/** No-show rate = noShow / (completed + noShow). null если нет проведённых/неявок. */
export function noShowRate(completed: number, noShow: number): number | null {
  const denom = completed + noShow
  return denom > 0 ? Math.round((noShow / denom) * 1000) / 1000 : null
}

/** CTR трекинг-ссылки = applications / clicks. null если нет кликов. */
export function linkCtr(clicks: number, applications: number): number | null {
  return clicks > 0 ? Math.round((applications / clicks) * 1000) / 1000 : null
}

/** Полностью ли закрыта вакансия (multi-hire): всего наймов >= headcount. */
export function isFullyFilled(totalHires: number, headcount: number): boolean {
  return totalHires >= Math.max(1, headcount)
}

/** Hire-rate источника = hires / applications. null если нет откликов. */
export function hireRate(applications: number, hires: number): number | null {
  return applications > 0 ? Math.round((hires / applications) * 1000) / 1000 : null
}

/**
 * Единый time-to-fill вакансии (Фаза 2, #7): openedAt → полное закрытие, в днях.
 *
 * Полное закрытие: status='closed' ИЛИ totalHires >= headcount.
 * endMoment: для multi-hire (headcount>1) — момент ПОСЛЕДНЕГО найма (lastHiredAt);
 * для headcount=1 — closedAt (приоритетно), fallback lastHiredAt.
 * null — если вакансия не закрыта или нет openedAt/endMoment.
 */
export function computeTimeToFill(params: {
  openedAt: Date | null
  closedAt: Date | null
  lastHiredAt: Date | null
  headcount: number
  status: string
  totalHires: number
}): number | null {
  const { openedAt, closedAt, lastHiredAt, headcount, status, totalHires } = params
  if (!openedAt) return null
  const fullyFilled = totalHires >= Math.max(1, headcount)
  if (status !== 'closed' && !fullyFilled) return null
  const endMoment = headcount > 1 ? lastHiredAt : (closedAt ?? lastHiredAt)
  if (!endMoment) return null
  return Math.round((endMoment.getTime() - openedAt.getTime()) / 86400000)
}
