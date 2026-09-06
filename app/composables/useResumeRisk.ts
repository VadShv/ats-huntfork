import type { MaybeRefOrGetter } from 'vue'

export interface RiskFinding {
  claim: string
  issue: string
  category: 'inconsistency' | 'suspicious' | 'fact_to_verify'
  confidence: 'date_math' | 'document' | 'linguistic'
  severity: 'low' | 'medium' | 'high'
  evidence: string
  alternative: string
  question: string
  listenFor: string
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

export interface ResumeRisk {
  id: string
  candidateId: string
  resumeVersionId: string
  status: 'running' | 'completed' | 'failed'
  overallRisk: 'low' | 'medium' | 'high'
  overallScore: number
  isCapped: boolean
  summary: string | null
  tenureJson: TenureFacts | Record<string, never>
  findingsJson: { findings?: RiskFinding[] } | Record<string, never>
  metricsJson: { density?: number, adequacy?: number } | Record<string, never>
  provider: string | null
  model: string | null
  errorMessage: string | null
  assessedAt: string | null
  createdAt: string
}

export interface RiskProfileResponse {
  candidateId: string
  resumeVersionId: string | null
  stale: boolean
  risk: ResumeRisk | null
}

/**
 * Risk profile of a candidate (current resume version) — Этап 3.
 * Also used on the application card (same endpoint, reused, no re-generation).
 */
export function useResumeRisk(candidateId: MaybeRefOrGetter<string>) {
  const { handlePreviewReadOnlyError } = usePreviewReadOnly()
  const id = computed(() => toValue(candidateId))

  const { data, status, error, refresh } = useFetch<RiskProfileResponse>(
    () => `/api/candidates/${id.value}/risk-profile`,
    {
      key: computed(() => `risk-profile-${id.value}`),
      headers: useRequestHeaders(['cookie']),
      default: () => ({ candidateId: '', resumeVersionId: null, stale: false, risk: null }),
    },
  )

  async function assess(force = false) {
    try {
      const res = await $fetch(`/api/candidates/${id.value}/risk-profile`, {
        method: 'POST',
        body: { force },
      })
      return res
    }
    catch (err) {
      handlePreviewReadOnlyError(err)
      throw err
    }
  }

  return { profile: data, status, error, refresh, assess }
}
