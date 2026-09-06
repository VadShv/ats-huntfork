<script setup lang="ts">
import { ShieldAlert, Loader2, RefreshCcw, ChevronRight } from 'lucide-vue-next'
import type { RiskFinding, TenureFacts } from '~/composables/useResumeRisk'

const props = defineProps<{
  candidateId: string
  /** Можно ли запускать анализ (нужна версия резюме). */
  canGenerate: boolean
  /** Компактный режим — для карточки отклика. */
  compact?: boolean
}>()

const emit = defineEmits<{
  /** Клик по находке / «подробнее» — родитель переключает панель резюме на «Риски». */
  (e: 'open-details'): void
}>()

const { t } = useI18n()
const toast = useToast()
const { profile, status, refresh, assess } = useResumeRisk(() => props.candidateId)

const isRunning = ref(false)
const risk = computed(() => profile.value?.risk ?? null)
const tenure = computed<TenureFacts | null>(() => {
  const tj = risk.value?.tenureJson
  return tj && 'hasStructuredDates' in tj ? tj as TenureFacts : null
})
const topFindings = computed<RiskFinding[]>(() => {
  const f = risk.value?.findingsJson
  const list = (f && 'findings' in f ? f.findings : []) ?? []
  const order = { high: 0, medium: 1, low: 2 } as const
  return [...list].sort((a, b) => order[a.severity] - order[b.severity]).slice(0, props.compact ? 2 : 3)
})

const levelClass: Record<string, string> = {
  low: 'bg-success-50 text-success-700 ring-success-200 dark:bg-success-950/50 dark:text-success-400 dark:ring-success-800',
  medium: 'bg-warning-50 text-warning-700 ring-warning-200 dark:bg-warning-950/50 dark:text-warning-400 dark:ring-warning-800',
  high: 'bg-danger-50 text-danger-700 ring-danger-200 dark:bg-danger-950/50 dark:text-danger-400 dark:ring-danger-800',
}

async function run() {
  if (!props.canGenerate || isRunning.value) return
  isRunning.value = true
  try {
    await assess(true)
    toast.success(t('candidate.risk.queued'))
    // Poll a few times for the background job to finish.
    for (let i = 0; i < 8; i++) {
      await new Promise(r => setTimeout(r, 2500))
      await refresh()
      if (risk.value?.status === 'completed' || risk.value?.status === 'failed') break
    }
  }
  catch {
    toast.error(t('candidate.risk.error'))
  }
  finally {
    isRunning.value = false
  }
}

const busy = computed(() => isRunning.value || risk.value?.status === 'running' || status.value === 'pending')
</script>

<template>
  <div class="rounded-lg border border-surface-200 bg-white p-4 dark:border-surface-800 dark:bg-surface-900">
    <div class="mb-2 flex items-center justify-between gap-2">
      <h3 class="inline-flex items-center gap-1.5 text-sm font-semibold text-surface-800 dark:text-surface-100">
        <ShieldAlert class="size-4 text-amber-600" />
        {{ t('candidate.risk.title') }}
      </h3>
      <div class="flex items-center gap-2">
        <span
          v-if="risk && risk.status === 'completed'"
          class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1"
          :class="levelClass[risk.overallRisk]"
        >
          {{ t(`candidate.risk.level.${risk.overallRisk}`) }}
        </span>
        <button
          type="button"
          :disabled="!canGenerate || busy"
          class="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-surface-500 hover:bg-surface-100 disabled:opacity-50 dark:text-surface-400 dark:hover:bg-surface-800"
          :title="canGenerate ? t('candidate.risk.refresh') : t('candidate.risk.noResume')"
          @click="run"
        >
          <Loader2 v-if="busy" class="size-3.5 animate-spin" />
          <RefreshCcw v-else class="size-3.5" />
          {{ risk ? t('candidate.risk.refresh') : t('candidate.risk.generate') }}
        </button>
      </div>
    </div>

    <!-- Empty / states -->
    <p v-if="!risk && !busy" class="text-xs text-surface-500 dark:text-surface-400">
      {{ t('candidate.risk.empty') }}
    </p>
    <p v-else-if="busy && !risk" class="inline-flex items-center gap-1.5 text-xs text-surface-400">
      <Loader2 class="size-3.5 animate-spin" /> {{ t('candidate.risk.running') }}
    </p>
    <p v-else-if="risk?.status === 'failed'" class="text-xs text-danger-600">
      {{ t('candidate.risk.failed') }}
    </p>

    <template v-else-if="risk?.status === 'completed'">
      <p v-if="risk.isCapped" class="mb-2 rounded bg-surface-50 px-2 py-1 text-[11px] text-surface-500 dark:bg-surface-800/60 dark:text-surface-400">
        {{ t('candidate.risk.capped') }}
      </p>

      <!-- Job hopping (deterministic) -->
      <div v-if="tenure?.hasStructuredDates" class="mb-3 rounded-md bg-surface-50 p-2 dark:bg-surface-800/50">
        <div class="flex items-center justify-between">
          <span class="text-xs font-medium text-surface-600 dark:text-surface-300">{{ t('candidate.risk.jobHopping') }}</span>
          <span
            class="rounded px-1.5 py-0.5 text-[11px] font-medium ring-1"
            :class="levelClass[tenure.jobHoppingLevel]"
          >{{ t(`candidate.risk.level.${tenure.jobHoppingLevel}`) }}</span>
        </div>
        <p class="mt-1 text-[11px] text-surface-500 dark:text-surface-400">
          {{ t('candidate.risk.jobsCount', { n: tenure.jobsCount }) }} ·
          {{ t('candidate.risk.avgTenure', { m: tenure.avgTenureMonths }) }}
          <template v-if="tenure.shortStints.length"> · {{ t('candidate.risk.shortStints', { n: tenure.shortStints.length }) }}</template>
        </p>
        <p class="mt-0.5 text-[10px] text-surface-400">{{ t('candidate.risk.computedNotAi') }}</p>
      </div>

      <!-- Top findings (LLM) -->
      <ul v-if="topFindings.length" class="space-y-1.5">
        <li
          v-for="(f, i) in topFindings"
          :key="i"
          class="cursor-pointer rounded-md border border-surface-100 p-2 text-xs hover:bg-surface-50 dark:border-surface-800 dark:hover:bg-surface-800/50"
          @click="emit('open-details')"
        >
          <div class="flex items-start gap-1.5">
            <span
              class="mt-0.5 size-2 shrink-0 rounded-full"
              :class="f.severity === 'high' ? 'bg-danger-500' : f.severity === 'medium' ? 'bg-warning-500' : 'bg-surface-400'"
            />
            <span class="text-surface-700 dark:text-surface-200">{{ f.issue || f.claim }}</span>
          </div>
        </li>
      </ul>
      <p v-else-if="!tenure?.hasStructuredDates" class="text-xs text-surface-500 dark:text-surface-400">
        {{ t('candidate.risk.noFindings') }}
      </p>

      <button
        type="button"
        class="mt-2 inline-flex items-center gap-0.5 text-[11px] text-brand-600 hover:text-brand-700"
        @click="emit('open-details')"
      >
        {{ t('candidate.risk.details') }} <ChevronRight class="size-3" />
      </button>
    </template>
  </div>
</template>
