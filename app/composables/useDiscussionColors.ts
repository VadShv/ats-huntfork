/**
 * Shared color helpers for the discussion module.
 * Eliminates duplication of scoreTone() and riskMeta() across
 * DiscussionContextWidgets and CommentSnapshotWidget.
 */

/** Score → semantic text color class (success / warning / danger). */
export function useScoreTone() {
  return (v: number): string => {
    if (v >= 75) return 'text-success-600 dark:text-success-400'
    if (v >= 40) return 'text-warning-600 dark:text-warning-400'
    return 'text-danger-600 dark:text-danger-400'
  }
}

export interface RiskMeta {
  label: string
  cls: string
  chip: string
}

/** Risk level → label + badge classes. Uses ATS semantic tokens. */
export function useRiskMeta() {
  const { t } = useI18n()

  return (level: string | null | undefined): RiskMeta => {
    const map: Record<string, RiskMeta> = {
      low: {
        label: t('discussion_widgets.risk_low'),
        cls: 'bg-success-100 text-success-800 dark:bg-success-900/40 dark:text-success-200',
        chip: 'bg-success-50 text-success-700 dark:bg-success-900/30 dark:text-success-300',
      },
      medium: {
        label: t('discussion_widgets.risk_medium'),
        cls: 'bg-warning-100 text-warning-800 dark:bg-warning-900/40 dark:text-warning-200',
        chip: 'bg-warning-50 text-warning-700 dark:bg-warning-900/30 dark:text-warning-300',
      },
      high: {
        label: t('discussion_widgets.risk_high'),
        cls: 'bg-danger-100 text-danger-800 dark:bg-danger-900/40 dark:text-danger-200',
        chip: 'bg-danger-50 text-danger-700 dark:bg-danger-900/30 dark:text-danger-300',
      },
    }
    return map[level ?? 'low'] ?? map.low
  }
}
