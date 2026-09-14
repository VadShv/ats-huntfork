import { extractError } from './useBankQuestions'

export type ReportTemplateKind = 'standard' | 'executive' | 'screening' | 'technical' | 'custom'

export interface ReportTemplate {
  id: string
  name: string
  description: string | null
  kind: ReportTemplateKind
  promptText: string
  preferredAiConfigId: string | null
  isDefault: boolean
  isActive: boolean
  version: number
}

export function useReportTemplates() {
  const toast = useToast()

  const { data, status, refresh } = useFetch<{ items: ReportTemplate[] }>(
    '/api/question-bank/report-templates',
    { key: 'report-templates', headers: useRequestHeaders(['cookie']), default: () => ({ items: [] }) },
  )

  const templates = computed(() => data.value?.items ?? [])
  const isLoading = computed(() => status.value === 'pending')

  async function create(input: { name: string, promptText: string, kind?: ReportTemplateKind, description?: string }) {
    try { const r = await $fetch<ReportTemplate>('/api/question-bank/report-templates', { method: 'POST', body: input }); toast.success('Шаблон создан'); await refresh(); return r }
    catch (e) { toast.error(extractError(e, 'Не удалось создать шаблон')); throw e }
  }
  async function update(id: string, patch: Partial<ReportTemplate>) {
    try { const r = await $fetch<ReportTemplate>(`/api/question-bank/report-templates/${id}`, { method: 'PATCH', body: patch }); toast.success('Сохранено'); await refresh(); return r }
    catch (e) { toast.error(extractError(e, 'Не удалось сохранить')); throw e }
  }
  async function setDefault(id: string) {
    try { await $fetch(`/api/question-bank/report-templates/${id}/set-default`, { method: 'POST' }); toast.success('Шаблон по умолчанию обновлён'); await refresh() }
    catch (e) { toast.error(extractError(e, 'Не удалось назначить по умолчанию')); throw e }
  }
  async function toggleActive(id: string, isActive: boolean) {
    try { await $fetch(`/api/question-bank/report-templates/${id}/toggle-active`, { method: 'POST', body: { isActive } }); toast.success(isActive ? 'Включён' : 'Выключен'); await refresh() }
    catch (e) { toast.error(extractError(e, 'Не удалось изменить статус')); throw e }
  }

  return { templates, isLoading, refresh, create, update, setDefault, toggleActive }
}
