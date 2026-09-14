import type { MaybeRefOrGetter } from 'vue'
import { extractError } from './useBankQuestions'
import type { InterviewStage } from './useBankQuestions'

export type PresetStatus = 'draft' | 'published' | 'archived'

export interface PresetSectionQuestion {
  id: string
  bankQuestionId: string
  isRequired: boolean
  displayOrder: number
}
export interface PresetSection {
  id: string
  presetId: string
  topicId: string
  title: string
  goal: string | null
  weight: number
  minQuestions: number
  maxQuestions: number
  displayOrder: number
  topic?: { id: string, name: string, type: string }
  questions?: PresetSectionQuestion[]
}
export interface QuestionPreset {
  id: string
  code: string | null
  name: string
  description: string | null
  interviewType: InterviewStage
  targetRoles: string[]
  seniority: string[]
  isDefault: boolean
  status: PresetStatus
  version: number
  sections?: PresetSection[]
}

export function useQuestionPresets(filters?: MaybeRefOrGetter<{ status?: PresetStatus | '', search?: string }>) {
  const toast = useToast()

  const query = computed(() => {
    const f = toValue(filters) ?? {}
    const params = new URLSearchParams()
    if (f.status) params.set('status', f.status)
    if (f.search) params.set('search', f.search)
    params.set('limit', '100')
    return params.toString()
  })

  const { data, status, refresh } = useFetch<{ items: QuestionPreset[] }>(
    () => `/api/question-bank/presets?${query.value}`,
    { key: computed(() => `presets-${query.value}`), headers: useRequestHeaders(['cookie']), default: () => ({ items: [] }) },
  )

  const presets = computed(() => data.value?.items ?? [])
  const isLoading = computed(() => status.value === 'pending')

  async function createPreset(input: { name: string, description?: string, interviewType?: InterviewStage }) {
    try {
      const created = await $fetch<QuestionPreset>('/api/question-bank/presets', { method: 'POST', body: input })
      toast.success('Пресет создан')
      await refresh()
      return created
    }
    catch (e) { toast.error(extractError(e, 'Не удалось создать пресет')); throw e }
  }
  async function updatePreset(id: string, patch: Partial<QuestionPreset>) {
    try { const r = await $fetch<QuestionPreset>(`/api/question-bank/presets/${id}`, { method: 'PATCH', body: patch }); toast.success('Сохранено'); await refresh(); return r }
    catch (e) { toast.error(extractError(e, 'Не удалось сохранить')); throw e }
  }
  async function publishPreset(id: string) {
    try { await $fetch(`/api/question-bank/presets/${id}/publish`, { method: 'POST' }); toast.success('Пресет опубликован'); await refresh() }
    catch (e) { toast.error(extractError(e, 'Не удалось опубликовать')); throw e }
  }
  async function archivePreset(id: string) {
    try { await $fetch(`/api/question-bank/presets/${id}/archive`, { method: 'POST' }); toast.success('Пресет архивирован'); await refresh() }
    catch (e) { toast.error(extractError(e, 'Не удалось архивировать')); throw e }
  }
  async function addSection(presetId: string, input: { topicId: string, title: string, goal?: string, weight?: number }) {
    try { const r = await $fetch(`/api/question-bank/presets/${presetId}/sections`, { method: 'POST', body: input }); toast.success('Раздел добавлен'); await refresh(); return r }
    catch (e) { toast.error(extractError(e, 'Не удалось добавить раздел')); throw e }
  }
  async function deleteSection(presetId: string, sectionId: string) {
    try { await $fetch(`/api/question-bank/presets/${presetId}/sections/${sectionId}`, { method: 'DELETE' }); toast.success('Раздел удалён'); await refresh() }
    catch (e) { toast.error(extractError(e, 'Не удалось удалить раздел')); throw e }
  }
  async function setSectionQuestions(presetId: string, sectionId: string, questions: { bankQuestionId: string, isRequired?: boolean, displayOrder?: number }[]) {
    try { await $fetch(`/api/question-bank/presets/${presetId}/sections/${sectionId}/questions`, { method: 'PUT', body: { questions } }); toast.success('Вопросы раздела сохранены'); await refresh() }
    catch (e) { toast.error(extractError(e, 'Не удалось сохранить вопросы')); throw e }
  }

  return {
    presets, isLoading, refresh,
    createPreset, updatePreset, publishPreset, archivePreset,
    addSection, deleteSection, setSectionQuestions,
  }
}
