<script setup lang="ts">
/**
 * Панель отчёта по интервью в карточке отклика (Спринт 5).
 * Два источника: MyMeet (hr-interview) / наш ассистент (BARS). Отчёт рядом с опросником.
 */
import { FileText, RefreshCw } from 'lucide-vue-next'
import { useInterviewReport } from '~/composables/useInterviewReport'
import { useReportTemplates } from '~/composables/useReportTemplates'

const props = defineProps<{ applicationId: string }>()

const { report, isProcessing, generate, refresh } = useInterviewReport(() => props.applicationId)
const { templates } = useReportTemplates()
const { allowed: canEdit } = usePermission({ interview: ['update'] })

const source = ref<'mymeet' | 'assistant'>('assistant')
const meetingId = ref('')
const templateId = ref('')
const busy = ref(false)

const sourceOptions = [
  { label: 'Наш ассистент (BARS)', value: 'assistant' },
  { label: 'MyMeet (hr-interview)', value: 'mymeet' },
]
const templateOptions = computed(() => templates.value.filter(t => t.isActive).map(t => ({
  label: `${t.name}${t.isDefault ? ' (по умолч.)' : ''}`, value: t.id,
})))

async function onGenerate() {
  if (!meetingId.value.trim()) return
  busy.value = true
  try { await generate(source.value, meetingId.value.trim(), source.value === 'assistant' ? (templateId.value || null) : null) }
  finally { busy.value = false }
}

const confidenceTone: Record<string, 'success' | 'warning' | 'neutral'> = { high: 'success', medium: 'warning', low: 'neutral' }
</script>

<template>
  <UiCard>
    <div class="mb-3 flex items-center justify-between gap-2">
      <h2 class="inline-flex items-center gap-1.5 text-sm font-semibold text-surface-700 dark:text-surface-200">
        <FileText class="size-4 text-brand-600" /> Отчёт по интервью
        <UiBadge v-if="report" :tone="report.source === 'assistant' ? 'accent' : 'info'" size="sm">
          {{ report.source === 'assistant' ? 'ассистент' : 'MyMeet' }}
        </UiBadge>
      </h2>
      <UiButton v-if="report && !isProcessing" variant="ghost" size="xs" :icon-left="RefreshCw" icon-only aria-label="Обновить" @click="refresh" />
    </div>

    <!-- Генерация -->
    <div v-if="canEdit && (!report || report.status === 'failed' || report.status === 'completed')" class="mb-3 space-y-2">
      <div class="flex flex-wrap items-end gap-2">
        <UiSegmented v-model="source" :options="sourceOptions" size="sm" />
      </div>
      <div class="flex flex-wrap items-end gap-2">
        <div class="flex-1 min-w-[160px]">
          <UiInput v-model="meetingId" label="ID встречи MyMeet" size="sm" placeholder="externalMeetingId" />
        </div>
        <UiSelect v-if="source === 'assistant'" v-model="templateId" :options="templateOptions" size="sm" class="w-52" placeholder="Шаблон (по умолч.)" />
        <UiButton variant="primary" size="sm" :loading="busy" :disabled="!meetingId.trim()" @click="onGenerate">
          {{ report ? 'Перегенерировать' : 'Сгенерировать' }}
        </UiButton>
      </div>
    </div>

    <div v-if="report?.status === 'importing' || report?.status === 'generating'" class="py-4 text-center text-sm text-surface-400">
      {{ report.status === 'generating' ? 'Ассистент готовит отчёт…' : 'Импорт отчёта из MyMeet…' }}
    </div>
    <div v-else-if="report?.status === 'failed'" class="rounded-lg border border-danger-300 bg-danger-50 dark:border-danger-800 dark:bg-danger-950/40 p-3 text-xs text-danger-700 dark:text-danger-300">
      Ошибка: {{ report.errorMessage || 'не удалось сформировать отчёт' }}
    </div>
    <div v-else-if="report?.status === 'completed'" class="space-y-3">
      <p v-if="report.summary" class="text-sm text-surface-800 dark:text-surface-200 whitespace-pre-line">{{ report.summary }}</p>

      <!-- Матчинг вопрос↔ответ (поток Б) -->
      <div v-if="report.questionAnswerMap?.length" class="space-y-1.5">
        <p class="text-xs font-semibold text-surface-500 uppercase tracking-wide">Ответы по вопросам</p>
        <div v-for="(qa, i) in report.questionAnswerMap" :key="i" class="rounded-lg border border-surface-200 dark:border-surface-800 p-2.5">
          <div class="flex items-start justify-between gap-2">
            <p class="text-xs font-medium text-surface-800 dark:text-surface-200">{{ qa.questionText }}</p>
            <div class="flex items-center gap-1 shrink-0">
              <UiBadge v-if="qa.barsValue" tone="brand" size="sm">{{ qa.barsValue }}</UiBadge>
              <UiBadge :tone="confidenceTone[qa.confidence]" size="sm">{{ qa.confidence }}</UiBadge>
            </div>
          </div>
          <p class="text-xs text-surface-600 dark:text-surface-400 mt-1">{{ qa.matched ? qa.answerText : 'недостаточно данных' }}</p>
          <p v-for="(ev, j) in qa.evidence" :key="j" class="text-[11px] text-surface-400 border-l-2 border-surface-200 dark:border-surface-700 pl-2 mt-1">{{ ev }}</p>
        </div>
      </div>

      <p v-if="report.generatedByModel" class="text-[11px] text-surface-400">Модель: {{ report.generatedByModel }}<span v-if="report.templateName"> · шаблон: {{ report.templateName }}</span></p>
    </div>
    <p v-else-if="!report" class="text-xs text-surface-500 dark:text-surface-400">
      Отчёт ещё не сформирован. Укажите ID встречи MyMeet и выберите источник.
    </p>
  </UiCard>
</template>
