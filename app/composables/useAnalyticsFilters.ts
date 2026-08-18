/**
 * Спринт 23: общее состояние фильтров страниц аналитики.
 * Период (пресеты), вакансия, источник, сравнение с предыдущим периодом.
 */
export function useAnalyticsFilters() {
  const periodPreset = useState<'7d' | '30d' | '90d'>('analytics-period', () => '30d')
  const jobId = useState<string | undefined>('analytics-job', () => undefined)
  const source = useState<string | undefined>('analytics-source', () => undefined)
  const compare = useState<boolean>('analytics-compare', () => true)

  const from = computed(() => {
    const days = { '7d': 7, '30d': 30, '90d': 90 }[periodPreset.value]
    const d = new Date()
    d.setDate(d.getDate() - days)
    return d.toISOString()
  })

  const query = computed<Record<string, string>>(() => {
    const q: Record<string, string> = { from: from.value }
    if (jobId.value) q.jobId = jobId.value
    if (source.value) q.source = source.value
    if (compare.value) q.compare = 'prev'
    return q
  })

  return { periodPreset, jobId, source, compare, from, query }
}
