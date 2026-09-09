/**
 * Центр аналитики (Фаза 1): чистая логика lifecycle-таймстампов вакансии.
 *
 * Вынесена из server/api/jobs/[id].patch.ts, чтобы поведение переходов статуса
 * (opened/closed/reopen/filled) было юнит-тестируемым без БД.
 */

export type JobStatus = 'draft' | 'open' | 'closed' | 'archived'

export interface JobLifecycleState {
  status: JobStatus
  firstOpenedAt: Date | null
  reopenCount: number
}

export interface JobLifecycleUpdate {
  openedAt?: Date | null
  closedAt?: Date | null
  firstOpenedAt?: Date
  reopenCount?: number
  closeReason?: string | null
  filledAt?: Date
}

/**
 * Вычисляет патч lifecycle-полей job при переходе статуса.
 * Возвращает пустой объект, если статус не меняется.
 *
 * @param prev   текущее состояние вакансии до апдейта
 * @param next   целевой статус (body.status)
 * @param now    момент перехода
 * @param closeReason опц. причина закрытия (учитывается только при next='closed')
 */
export function computeJobLifecycleUpdate(
  prev: JobLifecycleState,
  next: JobStatus | undefined,
  now: Date,
  closeReason?: string | null,
): JobLifecycleUpdate {
  if (!next || next === prev.status) return {}

  const patch: JobLifecycleUpdate = {}

  if (next === 'open') {
    patch.openedAt = now
    patch.closedAt = null
    if (prev.firstOpenedAt == null) patch.firstOpenedAt = now
    // Повторное открытие: вакансия ранее была закрыта или в архиве.
    if (prev.status === 'closed' || prev.status === 'archived') {
      patch.reopenCount = (prev.reopenCount ?? 0) + 1
    }
  }
  else if (next === 'closed') {
    patch.closedAt = now
    patch.closeReason = closeReason ?? null
    if (closeReason === 'filled') patch.filledAt = now
  }

  return patch
}
