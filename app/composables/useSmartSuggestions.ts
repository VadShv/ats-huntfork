/**
 * Context-aware quick-reply suggestions based on screening score and risk level.
 */

export interface SmartSuggestion {
  id: string
  label: string
  insertText: string
  kind: 'info' | 'warning' | 'success' | 'danger'
}

export function useSmartSuggestions() {
  const { t } = useI18n()

  function getSuggestions(opts: {
    score: number | null
    risk: 'low' | 'medium' | 'high' | null
    hasScore: boolean
  }): SmartSuggestion[] {
    const suggestions: SmartSuggestion[] = []
    const { score, risk, hasScore } = opts

    if (!hasScore) {
      suggestions.push({
        id: 'run-screening',
        label: t('smart_suggestions.run_screening'),
        insertText: '/score',
        kind: 'info',
      })
      return suggestions
    }

    if (score != null && score < 40) {
      suggestions.push(
        { id: 'request-details', label: t('smart_suggestions.request_details'), insertText: t('smart_suggestions.request_details_text'), kind: 'warning' },
        { id: 'schedule-call', label: t('smart_suggestions.schedule_call'), insertText: t('smart_suggestions.schedule_call_text'), kind: 'info' },
      )
    }

    if (risk === 'high') {
      suggestions.push(
        { id: 'request-docs', label: t('smart_suggestions.request_docs'), insertText: t('smart_suggestions.request_docs_text'), kind: 'danger' },
        { id: 'flag-review', label: t('smart_suggestions.flag_review'), insertText: t('smart_suggestions.flag_review_text'), kind: 'warning' },
      )
    }

    if (score != null && score >= 75) {
      suggestions.push(
        { id: 'interview-invite', label: t('smart_suggestions.interview_invite'), insertText: t('smart_suggestions.interview_invite_text'), kind: 'success' },
        { id: 'fast-track', label: t('smart_suggestions.fast_track'), insertText: t('smart_suggestions.fast_track_text'), kind: 'success' },
      )
    }

    return suggestions.slice(0, 4)
  }

  return { getSuggestions }
}
