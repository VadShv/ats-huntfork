import type { MaybeRefOrGetter } from 'vue'
import { extractError } from './useBankQuestions'

export type AssessmentTopicType =
  | 'value' | 'soft_skill' | 'management' | 'professional' | 'motivation' | 'expectations'
  | 'factcheck' | 'achievement_scale' | 'career_logic' | 'risk_zone' | 'culture' | 'custom'
export type TopicStatus = 'draft' | 'active' | 'archived'
export type ScaleType = 'numeric_5' | 'numeric_4' | 'numeric_3' | 'match_3' | 'verify_3' | 'level_5' | 'custom'

export interface BarsAnchor {
  id?: string
  value: string
  anchorText: string
  positiveExamples: string[]
  negativeExamples: string[]
  displayOrder: number
}

export interface AssessmentScale {
  id: string
  topicId: string
  name: string
  type: ScaleType
  minValue: number | null
  maxValue: number | null
  allowInsufficientData: boolean
  isDefault: boolean
  displayOrder: number
  anchors?: BarsAnchor[]
}

export interface AssessmentTopic {
  id: string
  organizationId: string
  code: string | null
  name: string
  shortName: string | null
  type: AssessmentTopicType
  definition: string | null
  goal: string | null
  positiveIndicators: string[]
  negativeIndicators: string[]
  parentTopicId: string | null
  targetRoles: string[]
  tags: string[]
  status: TopicStatus
  displayOrder: number
  createdAt: string
  updatedAt: string
  scales?: AssessmentScale[]
}

export interface TopicFilters {
  type?: AssessmentTopicType | ''
  status?: TopicStatus | ''
  parentTopicId?: string
  search?: string
  limit?: number
  offset?: number
}

export function useAssessmentTopics(filters?: MaybeRefOrGetter<TopicFilters>) {
  const toast = useToast()

  const query = computed(() => {
    const f = toValue(filters) ?? {}
    const params = new URLSearchParams()
    if (f.type) params.set('type', f.type)
    if (f.status) params.set('status', f.status)
    if (f.parentTopicId) params.set('parentTopicId', f.parentTopicId)
    if (f.search) params.set('search', f.search)
    params.set('limit', String(f.limit ?? 50))
    params.set('offset', String(f.offset ?? 0))
    return params.toString()
  })

  const { data, status, error, refresh } = useFetch<{ items: AssessmentTopic[], limit: number, offset: number }>(
    () => `/api/question-bank/topics?${query.value}`,
    {
      key: computed(() => `topics-${query.value}`),
      headers: useRequestHeaders(['cookie']),
      default: () => ({ items: [], limit: 50, offset: 0 }),
    },
  )

  const topics = computed(() => data.value?.items ?? [])
  const isLoading = computed(() => status.value === 'pending')

  async function createTopic(input: Partial<AssessmentTopic> & { name: string }) {
    try {
      const created = await $fetch<AssessmentTopic>('/api/question-bank/topics', { method: 'POST', body: input })
      toast.success('Тема создана')
      await refresh()
      return created
    }
    catch (e) { toast.error(extractError(e, 'Не удалось создать тему')); throw e }
  }

  async function updateTopic(id: string, patch: Partial<AssessmentTopic>) {
    try {
      const updated = await $fetch<AssessmentTopic>(`/api/question-bank/topics/${id}`, { method: 'PATCH', body: patch })
      toast.success('Сохранено')
      await refresh()
      return updated
    }
    catch (e) { toast.error(extractError(e, 'Не удалось сохранить')); throw e }
  }

  async function archiveTopic(id: string) {
    try {
      await $fetch(`/api/question-bank/topics/${id}/archive`, { method: 'POST' })
      toast.success('Тема архивирована')
      await refresh()
    }
    catch (e) { toast.error(extractError(e, 'Не удалось архивировать тему')); throw e }
  }

  // ── Шкалы ──
  async function createScale(topicId: string, input: Partial<AssessmentScale> & { name: string }) {
    try {
      const created = await $fetch<AssessmentScale>(`/api/question-bank/topics/${topicId}/scales`, { method: 'POST', body: input })
      toast.success('Шкала создана')
      await refresh()
      return created
    }
    catch (e) { toast.error(extractError(e, 'Не удалось создать шкалу')); throw e }
  }

  async function updateScale(scaleId: string, patch: Partial<AssessmentScale>) {
    try {
      const updated = await $fetch<AssessmentScale>(`/api/question-bank/scales/${scaleId}`, { method: 'PATCH', body: patch })
      await refresh()
      return updated
    }
    catch (e) { toast.error(extractError(e, 'Не удалось сохранить шкалу')); throw e }
  }

  async function deleteScale(scaleId: string) {
    try {
      await $fetch(`/api/question-bank/scales/${scaleId}`, { method: 'DELETE' })
      toast.success('Шкала удалена')
      await refresh()
    }
    catch (e) { toast.error(extractError(e, 'Не удалось удалить шкалу')); throw e }
  }

  async function replaceAnchors(scaleId: string, anchors: BarsAnchor[]) {
    try {
      await $fetch(`/api/question-bank/scales/${scaleId}/anchors`, { method: 'PUT', body: { anchors } })
      toast.success('Якоря сохранены')
      await refresh()
    }
    catch (e) { toast.error(extractError(e, 'Не удалось сохранить якоря')); throw e }
  }

  return {
    topics, isLoading, error, refresh,
    createTopic, updateTopic, archiveTopic,
    createScale, updateScale, deleteScale, replaceAnchors,
  }
}
