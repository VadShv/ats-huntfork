<script setup lang="ts">
import {
  X, Mail, Send, ChevronDown, Eye, Pencil, FileText,
  Check, AlertCircle, Plus, Trash2, Save, Sparkles,
} from 'lucide-vue-next'
import type { Interview } from '~/composables/useInterviews'
import type { EmailTemplate } from '~/composables/useEmailTemplates'

const props = defineProps<{
  interview: Interview
}>()

const emit = defineEmits<{
  close: []
  sent: []
}>()

const { templates, createTemplate, deleteTemplate, sendInvitation } = useEmailTemplates()
const { formatPersonName } = useOrgSettings()

// ─── System templates (from shared utility — auto-imported) ────

// ─── State ────────────────────────────────────────────────────────
type Tab = 'template' | 'custom' | 'manage'
const activeTab = ref<Tab>('template')
const selectedTemplateId = ref<string>('system-standard')
const showPreview = ref(false)
const isSending = ref(false)
const sendError = ref('')
const sendSuccess = ref(false)

// Custom email state
const customSubject = ref('')
const customBody = ref('')

// New template form state
const showNewTemplateForm = ref(false)
const newTemplateName = ref('')
const newTemplateSubject = ref('')
const newTemplateBody = ref('')
const isSavingTemplate = ref(false)
const templateSaveError = ref('')

// ─── Computed ─────────────────────────────────────────────────────
const allTemplates = computed(() => [
  ...SYSTEM_TEMPLATES.map(t => ({ ...t, isSystem: true as const })),
  ...(templates.value ?? []).map(t => ({ ...t, isSystem: false as const })),
])

const selectedTemplate = computed(() =>
  allTemplates.value.find(t => t.id === selectedTemplateId.value),
)

const { activeOrg } = useCurrentOrg()

const previewVariables: Record<string, string> = {
  candidateName: `${props.interview.candidateFirstName} ${props.interview.candidateLastName}`,
  candidateFirstName: props.interview.candidateFirstName,
  candidateLastName: props.interview.candidateLastName,
  candidateEmail: props.interview.candidateEmail,
  jobTitle: props.interview.jobTitle,
  interviewTitle: props.interview.title,
  interviewDate: new Date(props.interview.scheduledAt).toLocaleDateString('ru-RU', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  }),
  interviewTime: new Date(props.interview.scheduledAt).toLocaleTimeString('ru-RU', {
    hour: 'numeric', minute: '2-digit', hour12: false,
  }),
  interviewDuration: String(props.interview.duration),
  interviewType: {
    video: 'Видеозвонок', phone: 'Телефонный звонок', in_person: 'Личная встреча',
    technical: 'Техническое интервью', panel: 'Панельное интервью', take_home: 'Тестовое задание',
  }[props.interview.type] ?? props.interview.type,
  interviewLocation: props.interview.location ?? 'Будет уточнено',
  interviewers: props.interview.interviewers?.join(', ') ?? 'Будет уточнено',
  organizationName: activeOrg.value?.name ?? 'Ваша организация',
}

const previewSubject = computed(() => {
  if (activeTab.value === 'custom') return renderTemplatePreview(customSubject.value, previewVariables)
  return selectedTemplate.value ? renderTemplatePreview(selectedTemplate.value.subject, previewVariables) : ''
})

const previewBody = computed(() => {
  if (activeTab.value === 'custom') return renderTemplatePreview(customBody.value, previewVariables)
  return selectedTemplate.value ? renderTemplatePreview(selectedTemplate.value.body, previewVariables) : ''
})

// ─── Actions ──────────────────────────────────────────────────────
async function handleSend() {
  sendError.value = ''
  isSending.value = true

  try {
    const payload = activeTab.value === 'custom'
      ? { customSubject: customSubject.value, customBody: customBody.value }
      : { templateId: selectedTemplateId.value }

    await sendInvitation(props.interview.id, payload)
    sendSuccess.value = true
    setTimeout(() => emit('sent'), 1500)
  } catch (err: any) {
    sendError.value = err?.data?.statusMessage ?? err?.message ?? 'Не удалось отправить письмо с приглашением'
  } finally {
    isSending.value = false
  }
}

async function handleSaveTemplate() {
  templateSaveError.value = ''
  if (!newTemplateName.value.trim() || !newTemplateSubject.value.trim() || !newTemplateBody.value.trim()) {
    templateSaveError.value = 'Заполните все поля'
    return
  }

  isSavingTemplate.value = true
  try {
    await createTemplate({
      name: newTemplateName.value.trim(),
      subject: newTemplateSubject.value.trim(),
      body: newTemplateBody.value.trim(),
    })
    showNewTemplateForm.value = false
    newTemplateName.value = ''
    newTemplateSubject.value = ''
    newTemplateBody.value = ''
  } catch (err: any) {
    templateSaveError.value = err?.data?.statusMessage ?? 'Не удалось сохранить шаблон'
  } finally {
    isSavingTemplate.value = false
  }
}

async function handleDeleteTemplate(id: string) {
  try {
    await deleteTemplate(id)
    if (selectedTemplateId.value === id) {
      selectedTemplateId.value = 'system-standard'
    }
  } catch {
    // Handled by composable
  }
}

const canSend = computed(() => {
  if (activeTab.value === 'custom') {
    return customSubject.value.trim().length > 0 && customBody.value.trim().length > 0
  }
  return !!selectedTemplateId.value
})

// Use AVAILABLE_VARIABLES from auto-imported ~/utils/system-templates
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-50 flex items-center justify-center">
      <!-- Backdrop -->
      <div class="absolute inset-0 bg-black/40 backdrop-blur-[2px]" @click="emit('close')" />

      <!-- Modal -->
      <div class="relative bg-white dark:bg-surface-900 rounded-2xl shadow-2xl shadow-surface-900/10 dark:shadow-black/30 ring-1 ring-surface-200/80 dark:ring-surface-700/60 w-full max-w-2xl mx-4 max-h-[90vh] flex flex-col overflow-hidden">
        <!-- Header -->
        <div class="shrink-0 border-b border-surface-200/80 dark:border-surface-800/60 px-4 sm:px-6 py-4">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2.5">
              <div class="flex size-9 items-center justify-center rounded-lg bg-brand-50 dark:bg-brand-950/40">
                <Mail class="size-4.5 text-brand-600 dark:text-brand-400" />
              </div>
              <div>
                <h2 class="text-base font-semibold text-surface-900 dark:text-surface-100">
                  Отправить приглашение на интервью                </h2>
                <p class="text-xs text-surface-500 dark:text-surface-400">
                  Кому: {{ formatPersonName(interview.candidateFirstName, interview.candidateLastName) }} · {{ interview.candidateEmail }}
                </p>
              </div>
            </div>
            <button
              class="rounded-lg p-1.5 text-surface-400 hover:text-surface-600 hover:bg-surface-100 dark:hover:text-surface-300 dark:hover:bg-surface-800 transition-all cursor-pointer"
              @click="emit('close')"
            >
              <X class="size-5" />
            </button>
          </div>
        </div>

        <!-- Success state -->
        <div v-if="sendSuccess" class="flex-1 flex flex-col items-center justify-center py-12 px-6">
          <div class="flex size-14 items-center justify-center rounded-full bg-success-100 dark:bg-success-950/40 mb-4">
            <Check class="size-7 text-success-600 dark:text-success-400" />
          </div>
          <h3 class="text-lg font-semibold text-surface-900 dark:text-surface-100 mb-1.5">Приглашение отправлено!</h3>
          <p class="text-sm text-surface-500 dark:text-surface-400 text-center">
            Приглашение на интервью отправлено на {{ interview.candidateEmail }}.
          </p>
        </div>

        <!-- Main content -->
        <template v-else>
          <!-- Tabs -->
          <div class="shrink-0 border-b border-surface-200/80 dark:border-surface-800/60 px-4 sm:px-6 overflow-x-auto scrollbar-none">
            <div class="flex gap-1">
              <button
                v-for="tab in ([
                  { id: 'template' as Tab, label: 'Выбрать шаблон', icon: FileText },
                  { id: 'custom' as Tab, label: 'Своё письмо', icon: Pencil },
                  { id: 'manage' as Tab, label: 'Управление шаблонами', icon: Sparkles },
                ])"
                :key="tab.id"
                class="flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium border-b-2 transition-all cursor-pointer -mb-px whitespace-nowrap shrink-0"
                :class="activeTab === tab.id
                  ? 'border-brand-500 text-brand-700 dark:text-brand-300'
                  : 'border-transparent text-surface-500 hover:text-surface-700 dark:hover:text-surface-300'"
                @click="activeTab = tab.id"
              >
                <component :is="tab.icon" class="size-3.5" />
                {{ tab.label }}
              </button>
            </div>
          </div>

          <!-- Error -->
          <div v-if="sendError" class="mx-4 sm:mx-6 mt-4 flex items-start gap-2.5 rounded-xl border border-danger-200/80 bg-danger-50 p-3.5 text-sm text-danger-700 dark:border-danger-800/60 dark:bg-danger-950/40 dark:text-danger-300">
            <AlertCircle class="size-4 shrink-0 mt-0.5" />
            {{ sendError }}
          </div>

          <!-- Tab content -->
          <div class="flex-1 overflow-y-auto px-4 sm:px-6 py-5">
            <!-- Template Selection Tab -->
            <div v-if="activeTab === 'template'" class="space-y-3">
              <p class="text-xs text-surface-500 dark:text-surface-400 mb-3">
                Выберите шаблон для отправки приглашения на интервью.              </p>
              <button
                v-for="t in allTemplates"
                :key="t.id"
                type="button"
                class="w-full text-left rounded-xl border-2 p-4 transition-all duration-150 cursor-pointer"
                :class="selectedTemplateId === t.id
                  ? 'border-brand-500 bg-brand-50/50 dark:border-brand-400 dark:bg-brand-950/20 shadow-sm'
                  : 'border-surface-200 dark:border-surface-700/80 hover:border-surface-300 dark:hover:border-surface-600 hover:bg-surface-50 dark:hover:bg-surface-800/40'"
                @click="selectedTemplateId = t.id"
              >
                <div class="flex items-center justify-between mb-1">
                  <span class="text-sm font-semibold text-surface-800 dark:text-surface-200">{{ t.name }}</span>
                  <span v-if="t.isSystem" class="text-[10px] uppercase tracking-wider font-semibold text-surface-400 bg-surface-100 dark:bg-surface-800 px-1.5 py-0.5 rounded">
                    Встроенный                  </span>
                </div>
                <p class="text-xs text-surface-500 dark:text-surface-400 truncate">
                  Тема: {{ t.subject }}
                </p>
              </button>

              <!-- Preview toggle -->
              <div v-if="selectedTemplate" class="mt-4">
                <button
                  type="button"
                  class="flex items-center gap-1.5 text-sm font-medium text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 transition-colors cursor-pointer"
                  @click="showPreview = !showPreview"
                >
                  <Eye class="size-3.5" />
                  {{ showPreview ? 'Скрыть предпросмотр' : 'Показать предпросмотр' }}
                  <ChevronDown
                    class="size-3.5 transition-transform"
                    :class="showPreview ? 'rotate-180' : ''"
                  />
                </button>
                <div v-if="showPreview" class="mt-3 rounded-xl border border-surface-200 dark:border-surface-700/80 bg-surface-50 dark:bg-surface-800/40 p-4">
                  <div class="mb-2">
                    <span class="text-[10px] uppercase tracking-wider font-semibold text-surface-400">Тема</span>
                    <p class="text-sm font-semibold text-surface-800 dark:text-surface-200">{{ previewSubject }}</p>
                  </div>
                  <div>
                    <span class="text-[10px] uppercase tracking-wider font-semibold text-surface-400">Текст письма</span>
                    <p class="text-sm text-surface-700 dark:text-surface-300 whitespace-pre-wrap mt-1">{{ previewBody }}</p>
                  </div>
                </div>
              </div>
            </div>

            <!-- Custom Email Tab -->
            <div v-else-if="activeTab === 'custom'" class="space-y-4">
              <div>
                <label for="custom-subject" class="block text-xs font-semibold uppercase tracking-wider text-surface-500 dark:text-surface-400 mb-1.5">
                  Тема                </label>
                <input
                  id="custom-subject"
                  v-model="customSubject"
                  type="text"
                  placeholder="Например, приглашение на интервью: {{jobTitle}}"
                  class="w-full rounded-lg border border-surface-200 dark:border-surface-700 px-3 py-2.5 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-800 placeholder:text-surface-400 dark:placeholder:text-surface-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500 transition-all"
                />
              </div>

              <div>
                <label for="custom-body" class="block text-xs font-semibold uppercase tracking-wider text-surface-500 dark:text-surface-400 mb-1.5">
                  Текст письма                </label>
                <textarea
                  id="custom-body"
                  v-model="customBody"
                  rows="10"
                  placeholder="Напишите текст приглашения. Используйте {{variables}} для динамических данных…"
                  class="w-full rounded-lg border border-surface-200 dark:border-surface-700 px-3 py-2.5 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-800 placeholder:text-surface-400 dark:placeholder:text-surface-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500 transition-all resize-none font-mono"
                />
              </div>

              <!-- Variable reference -->
              <div class="rounded-xl border border-surface-200/60 dark:border-surface-700/40 bg-surface-50 dark:bg-surface-800/30 p-3.5">
                <p class="text-[10px] uppercase tracking-wider font-semibold text-surface-400 mb-2">Доступные переменные</p>
                <div class="flex flex-wrap gap-1.5">
                  <span
                    v-for="v in AVAILABLE_VARIABLES"
                    :key="v.key"
                    class="inline-flex items-center gap-1 rounded-md bg-brand-50 dark:bg-brand-950/30 px-2 py-1 text-[11px] font-mono text-brand-700 dark:text-brand-300"
                    :title="v.desc"
                  >
                    {{ v.key }}
                  </span>
                </div>
              </div>

              <!-- Preview -->
              <div v-if="customSubject || customBody">
                <button
                  type="button"
                  class="flex items-center gap-1.5 text-sm font-medium text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 transition-colors cursor-pointer"
                  @click="showPreview = !showPreview"
                >
                  <Eye class="size-3.5" />
                  {{ showPreview ? 'Скрыть предпросмотр' : 'Предпросмотр с фактическими данными' }}
                </button>
                <div v-if="showPreview" class="mt-3 rounded-xl border border-surface-200 dark:border-surface-700/80 bg-surface-50 dark:bg-surface-800/40 p-4">
                  <div class="mb-2">
                    <span class="text-[10px] uppercase tracking-wider font-semibold text-surface-400">Тема</span>
                    <p class="text-sm font-semibold text-surface-800 dark:text-surface-200">{{ previewSubject }}</p>
                  </div>
                  <div>
                    <span class="text-[10px] uppercase tracking-wider font-semibold text-surface-400">Текст письма</span>
                    <p class="text-sm text-surface-700 dark:text-surface-300 whitespace-pre-wrap mt-1">{{ previewBody }}</p>
                  </div>
                </div>
              </div>
            </div>

            <!-- Manage Templates Tab -->
            <div v-else-if="activeTab === 'manage'" class="space-y-4">
              <div class="flex items-center justify-between">
                <p class="text-xs text-surface-500 dark:text-surface-400">
                  Создавайте и управляйте шаблонами писем для вашей организации.                </p>
                <button
                  v-if="!showNewTemplateForm"
                  type="button"
                  class="flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 transition-all cursor-pointer"
                  @click="showNewTemplateForm = true"
                >
                  <Plus class="size-3.5" />
                  Новый шаблон                </button>
              </div>

              <!-- New template form -->
              <div v-if="showNewTemplateForm" class="rounded-xl border border-brand-200 dark:border-brand-800/60 bg-brand-50/30 dark:bg-brand-950/20 p-4 space-y-3">
                <h4 class="text-sm font-semibold text-surface-800 dark:text-surface-200">Создать шаблон</h4>
                <div v-if="templateSaveError" class="rounded-lg border border-danger-200 bg-danger-50 p-2.5 text-xs text-danger-700 dark:border-danger-800 dark:bg-danger-950/40 dark:text-danger-300">
                  {{ templateSaveError }}
                </div>
                <input
                  v-model="newTemplateName"
                  type="text"
                  placeholder="Название шаблона"
                  class="w-full rounded-lg border border-surface-200 dark:border-surface-700 px-3 py-2 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-800 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500 transition-all"
                />
                <input
                  v-model="newTemplateSubject"
                  type="text"
                  placeholder="Тема (используйте {{variables}})"
                  class="w-full rounded-lg border border-surface-200 dark:border-surface-700 px-3 py-2 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-800 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500 transition-all"
                />
                <textarea
                  v-model="newTemplateBody"
                  rows="6"
                  placeholder="Текст письма (используйте {{variables}} для динамических данных)"
                  class="w-full rounded-lg border border-surface-200 dark:border-surface-700 px-3 py-2 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-800 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500 transition-all resize-none font-mono"
                />
                <div class="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    class="rounded-lg border border-surface-200 dark:border-surface-700 px-3 py-1.5 text-xs font-medium text-surface-600 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800 transition-all cursor-pointer"
                    @click="showNewTemplateForm = false"
                  >
                    Отмена                  </button>
                  <button
                    type="button"
                    :disabled="isSavingTemplate"
                    class="flex items-center gap-1 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all cursor-pointer"
                    @click="handleSaveTemplate"
                  >
                    <Save class="size-3" />
                    {{ isSavingTemplate ? 'Сохранение…' : 'Сохранить шаблон' }}
                  </button>
                </div>
              </div>

              <!-- Existing custom templates -->
              <div v-if="templates && templates.length > 0" class="space-y-2">
                <h4 class="text-xs font-semibold uppercase tracking-wider text-surface-400 mb-2">Ваши шаблоны</h4>
                <div
                  v-for="t in templates"
                  :key="t.id"
                  class="flex items-center justify-between rounded-xl border border-surface-200 dark:border-surface-700/80 bg-white dark:bg-surface-800/40 p-3.5"
                >
                  <div class="min-w-0 flex-1">
                    <p class="text-sm font-semibold text-surface-800 dark:text-surface-200 truncate">{{ t.name }}</p>
                    <p class="text-xs text-surface-500 dark:text-surface-400 truncate mt-0.5">{{ t.subject }}</p>
                  </div>
                  <button
                    type="button"
                    class="shrink-0 ml-3 rounded-lg p-1.5 text-surface-400 hover:text-danger-600 hover:bg-danger-50 dark:hover:text-danger-400 dark:hover:bg-danger-950/40 transition-all cursor-pointer"
                    @click="handleDeleteTemplate(t.id)"
                  >
                    <Trash2 class="size-3.5" />
                  </button>
                </div>
              </div>

              <div v-else-if="!showNewTemplateForm" class="text-center py-6">
                <p class="text-sm text-surface-400 dark:text-surface-500">Пользовательских шаблонов пока нет.</p>
                <p class="text-xs text-surface-400 dark:text-surface-500 mt-1">Создайте шаблон для повторного использования в приглашениях на интервью.</p>
              </div>

              <!-- Variable reference -->
              <div class="rounded-xl border border-surface-200/60 dark:border-surface-700/40 bg-surface-50 dark:bg-surface-800/30 p-3.5">
                <p class="text-[10px] uppercase tracking-wider font-semibold text-surface-400 mb-2">Доступные переменные</p>
                <div class="flex flex-wrap gap-1.5">
                  <span
                    v-for="v in AVAILABLE_VARIABLES"
                    :key="v.key"
                    class="inline-flex items-center gap-1 rounded-md bg-brand-50 dark:bg-brand-950/30 px-2 py-1 text-[11px] font-mono text-brand-700 dark:text-brand-300"
                    :title="v.desc"
                  >
                    {{ v.key }}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <!-- Footer -->
          <div v-if="activeTab !== 'manage'" class="shrink-0 border-t border-surface-200/80 dark:border-surface-800/60 bg-surface-50/80 dark:bg-surface-950/60 px-6 py-4">
            <div class="flex items-center gap-3">
              <button
                type="button"
                class="flex-1 rounded-xl border border-surface-200 dark:border-surface-700 px-4 py-2.5 text-sm font-medium text-surface-700 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-800 transition-all cursor-pointer"
                @click="emit('close')"
              >
                Отмена              </button>
              <button
                type="button"
                :disabled="!canSend || isSending"
                class="flex-1 flex items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all cursor-pointer shadow-sm shadow-brand-500/20"
                @click="handleSend"
              >
                <Send class="size-4" />
                {{ isSending ? 'Отправка…' : 'Отправить приглашение' }}
              </button>
            </div>
          </div>
        </template>
      </div>
    </div>
  </Teleport>
</template>
