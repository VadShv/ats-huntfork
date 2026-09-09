/**
 * Центр аналитики: общее состояние фильтров страниц аналитики.
 * Период (пресеты 7/30/90d + custom-диапазон), вакансия, рекрутер, источник,
 * отдел, groupBy, сравнение. URL-синхронизация + сериализация в пресеты.
 */
export function useAnalyticsFilters() {
  const route = useRoute()
  const router = useRouter()

  const periodPreset = useState<'7d' | '30d' | '90d' | 'custom'>('analytics-period', () => '30d')
  const customFrom = useState<string | undefined>('analytics-custom-from', () => undefined) // YYYY-MM-DD
  const customTo = useState<string | undefined>('analytics-custom-to', () => undefined)
  const jobId = useState<string | undefined>('analytics-job', () => undefined)
  const source = useState<string | undefined>('analytics-source', () => undefined)
  const recruiterId = useState<string | undefined>('analytics-recruiter', () => undefined)
  const departmentId = useState<string | undefined>('analytics-department', () => undefined)
  const groupBy = useState<'day' | 'week' | 'month'>('analytics-groupby', () => 'week')
  const compare = useState<boolean>('analytics-compare', () => true)

  // ── URL → state (один раз при монтировании) ──
  if (import.meta.client) {
    onMounted(() => {
      const q = route.query
      if (q.period) periodPreset.value = q.period as any
      if (q.customFrom) customFrom.value = q.customFrom as string
      if (q.customTo) customTo.value = q.customTo as string
      if (q.jobId) jobId.value = q.jobId as string
      if (q.source) source.value = q.source as string
      if (q.recruiterId) recruiterId.value = q.recruiterId as string
      if (q.departmentId) departmentId.value = q.departmentId as string
      if (q.groupBy) groupBy.value = q.groupBy as 'day' | 'week' | 'month'
      if (q.compare !== undefined) compare.value = q.compare === '1'
    })
  }

  // ── state → URL ──
  if (import.meta.client) {
    watch([periodPreset, customFrom, customTo, jobId, source, recruiterId, departmentId, groupBy, compare], () => {
      const params: Record<string, string> = { period: periodPreset.value }
      if (periodPreset.value === 'custom') {
        if (customFrom.value) params.customFrom = customFrom.value
        if (customTo.value) params.customTo = customTo.value
      }
      if (jobId.value) params.jobId = jobId.value
      if (source.value) params.source = source.value
      if (recruiterId.value) params.recruiterId = recruiterId.value
      if (departmentId.value) params.departmentId = departmentId.value
      if (groupBy.value !== 'week') params.groupBy = groupBy.value
      if (!compare.value) params.compare = '0'
      router.replace({ query: params })
    })
  }

  const from = computed(() => {
    if (periodPreset.value === 'custom' && customFrom.value) {
      return new Date(`${customFrom.value}T00:00:00.000Z`).toISOString()
    }
    const days = { '7d': 7, '30d': 30, '90d': 90 }[periodPreset.value] ?? 30
    const d = new Date()
    d.setDate(d.getDate() - days)
    return d.toISOString()
  })

  const to = computed<string | undefined>(() => {
    if (periodPreset.value === 'custom' && customTo.value) {
      return new Date(`${customTo.value}T23:59:59.999Z`).toISOString()
    }
    return undefined
  })

  const query = computed<Record<string, string>>(() => {
    const q: Record<string, string> = { from: from.value }
    if (to.value) q.to = to.value
    if (jobId.value) q.jobId = jobId.value
    if (source.value) q.source = source.value
    if (recruiterId.value) q.recruiterId = recruiterId.value
    if (departmentId.value) q.departmentId = departmentId.value
    if (groupBy.value) q.groupBy = groupBy.value
    if (compare.value) q.compare = 'prev'
    return q
  })

  /** Сериализовать текущее состояние фильтров (для сохранения пресета). */
  function serialize(): Record<string, string> {
    const s: Record<string, string> = { period: periodPreset.value, groupBy: groupBy.value, compare: compare.value ? '1' : '0' }
    if (periodPreset.value === 'custom') {
      if (customFrom.value) s.customFrom = customFrom.value
      if (customTo.value) s.customTo = customTo.value
    }
    if (jobId.value) s.jobId = jobId.value
    if (source.value) s.source = source.value
    if (recruiterId.value) s.recruiterId = recruiterId.value
    if (departmentId.value) s.departmentId = departmentId.value
    return s
  }

  /** Применить пресет (восстановить состояние из сериализованных фильтров). */
  function applyPreset(f: Record<string, string>) {
    if (f.period) periodPreset.value = f.period as any
    customFrom.value = f.customFrom || undefined
    customTo.value = f.customTo || undefined
    if (f.groupBy) groupBy.value = f.groupBy as 'day' | 'week' | 'month'
    compare.value = f.compare !== '0'
    jobId.value = f.jobId || undefined
    source.value = f.source || undefined
    recruiterId.value = f.recruiterId || undefined
    departmentId.value = f.departmentId || undefined
  }

  return { periodPreset, customFrom, customTo, jobId, source, recruiterId, departmentId, groupBy, compare, from, to, query, serialize, applyPreset }
}
