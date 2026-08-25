/**
 * useHmApi — тонкий клиент для эндпоинтов /api/hm/* (Спринт 20.3-20.4).
 * Все методы — простые $fetch, авто-креденшелы через cookie.
 */

export interface HmDashboardJob {
  id: string
  title: string
  location: string | null
  status: string
  pendingCount: number
  /** ТЗ hm-review-substage: 'queue' — очередь «На рассмотрении»; 'legacy' — все неразобранные. */
  reviewMode: 'queue' | 'legacy'
}

export interface HmQueueItem {
  applicationId: string
  candidateId: string
  fullName: string
  city: string | null
  job: { id: string; title: string }
  createdAt: string | Date
  stageChangedAt: string | Date | null
}

export interface HmNotice {
  code: string
  message: string
}

export interface HmDashboardResponse {
  jobs: HmDashboardJob[]
  queue: HmQueueItem[]
  notices: HmNotice[]
}

export interface HmApplicationResponse {
  application: {
    id: string
    status: string
    createdAt: string | Date
    stageChangedAt: string | Date | null
    currentStage: { name: string; type: string } | null
    isOnNewStage: boolean
    /** ТЗ hm-review-substage: кандидат в очереди НМ. */
    isInReview: boolean
  }
  /** ТЗ hm-review-substage: режим очереди воронки этой вакансии. */
  reviewMode: 'queue' | 'legacy'
  candidate: {
    id: string
    fullName: string
    city: string | null
    aiSummary: string | null
    expectedSalary: { amount?: number; currency?: string } | null
    resume: null | {
      title?: string
      about?: string
      totalExperienceMonths?: number
      area?: string
      keySkills?: string[]
      languages?: Array<{ name?: string; level?: string }>
      experiences?: Array<{
        company?: string
        position?: string
        description?: string
        start?: string
        end?: string
      }>
      education?: Array<{
        name?: string
        organization?: string
        result?: string
        year?: number
      }>
      professionalRoles?: string[]
      employments?: string[]
      schedules?: string[]
      updatedAt?: string
    }
  }
  job: { id: string; title: string; location: string | null }
  effectiveDecision: null | {
    id: string
    decision: 'approved' | 'rejected'
    hmUserId: string
    decidedAt: string | Date
    comment: string | null
  }
  canDecide: boolean
  permissions: { canViewSalary: boolean }
}

export function useHmApi() {
  async function fetchDashboard(): Promise<HmDashboardResponse> {
    return await $fetch<HmDashboardResponse>('/api/hm/dashboard')
  }

  async function fetchApplication(id: string): Promise<HmApplicationResponse> {
    return await $fetch<HmApplicationResponse>(`/api/hm/applications/${id}`)
  }

  async function submitDecision(payload: {
    applicationId: string
    decision: 'approved' | 'rejected'
    comment?: string
  }) {
    return await $fetch<{
      success: true
      decision: { id: string; applicationId: string; decision: string; targetStage: string }
      stage: { fromStageName: string | null; toStageName: string | null } | null
    }>('/api/hm/decisions', {
      method: 'POST',
      body: payload,
    })
  }

  async function cancelDecision(decisionId: string, reason?: string) {
    return await $fetch<{ success: true; decisionId: string }>(
      `/api/hm/decisions/${decisionId}/cancel`,
      {
        method: 'POST',
        body: { reason },
      },
    )
  }

  async function changePassword(payload: {
    currentPassword: string
    newPassword: string
  }) {
    return await $fetch<{ success: true }>('/api/auth/hm/change-password', {
      method: 'POST',
      body: payload,
    })
  }

  return {
    fetchDashboard,
    fetchApplication,
    submitDecision,
    cancelDecision,
    changePassword,
  }
}
