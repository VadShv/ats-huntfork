/**
 * Единый источник истины для legacy-статусов отклика.
 * Legacy-статусы отображаются только как fallback, если у отклика нет стадии
 * (см. правило: «стадия — основной индикатор; статус — если стадии нет вообще»).
 */
export type ApplicationStatus =
  | 'applied'
  | 'screening'
  | 'interview'
  | 'offer'
  | 'hired'
  | 'rejected'
  | 'withdrawn'
  | string

export interface ApplicationStatusMeta {
  key: ApplicationStatus
  label: string
  /** Цветовой тон, единый для всей системы */
  tone: 'neutral' | 'info' | 'accent' | 'warning' | 'success' | 'danger'
  /** Tailwind классы для pill: фон + текст + рамка (light + dark). */
  badgeClass: string
  /** Цвет точки-индикатора */
  dotClass: string
}

const CONFIG: Record<string, Omit<ApplicationStatusMeta, 'key' | 'label'>> = {
  applied: {
    tone: 'info',
    badgeClass: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800',
    dotClass: 'bg-blue-500',
  },
  screening: {
    tone: 'accent',
    badgeClass:
      'bg-accent-50 text-accent-700 border-accent-200 dark:bg-accent-900/30 dark:text-accent-300 dark:border-accent-800',
    dotClass: 'bg-accent-500',
  },
  interview: {
    tone: 'warning',
    badgeClass:
      'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800',
    dotClass: 'bg-amber-500',
  },
  offer: {
    tone: 'success',
    badgeClass:
      'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800',
    dotClass: 'bg-emerald-500',
  },
  hired: {
    tone: 'success',
    badgeClass:
      'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-900/50 dark:text-emerald-200 dark:border-emerald-700',
    dotClass: 'bg-emerald-600',
  },
  rejected: {
    tone: 'danger',
    badgeClass: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800',
    dotClass: 'bg-red-500',
  },
  withdrawn: {
    tone: 'neutral',
    badgeClass:
      'bg-surface-100 text-surface-600 border-surface-200 dark:bg-surface-800 dark:text-surface-400 dark:border-surface-700',
    dotClass: 'bg-surface-400',
  },
}

const DEFAULT_META: Omit<ApplicationStatusMeta, 'key' | 'label'> = {
  tone: 'neutral',
  badgeClass:
    'bg-surface-100 text-surface-600 border-surface-200 dark:bg-surface-800 dark:text-surface-400 dark:border-surface-700',
  dotClass: 'bg-surface-400',
}

const LABELS: Record<string, string> = {
  applied: 'Откликнулся',
  screening: 'Скрининг',
  interview: 'Интервью',
  offer: 'Оффер',
  hired: 'Нанят',
  rejected: 'Отклонён',
  withdrawn: 'Отозван',
}

export function getApplicationStatusMeta(status: ApplicationStatus | null | undefined): ApplicationStatusMeta {
  const key = (status ?? 'applied') as string
  const cfg = CONFIG[key] ?? DEFAULT_META
  return {
    key,
    label: LABELS[key] ?? key,
    ...cfg,
  }
}
