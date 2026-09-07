<script setup lang="ts">
/**
 * Collaboration Hub (Этап 2) — контекст-шапка обсуждения.
 *
 * Две компактные карточки над тредом:
 *   • AI-скрининг  — балл отклика + топ-пробелы (gaps). Per-application.
 *   • Оценка рисков — уровень + summary + счётчик находок. Per-candidate
 *     (риск считается на версию резюме и общий для всех откликов), с флагом stale.
 *
 * Данные тянутся из готовых API (scores + risk-profile). Карточки сворачиваемые
 * (состояние в localStorage). «Подробнее» эмитит наверх — навигацию делает родитель.
 */
import { computed } from 'vue'
import { Bot, ShieldAlert, ChevronDown, ChevronUp, AlertTriangle, ExternalLink } from 'lucide-vue-next'
import { useResumeRisk } from '~/composables/useResumeRisk'

const props = defineProps<{
  applicationId: string
  candidateId: string
  compact?: boolean
}>()

const emit = defineEmits<{
  openScreening: []
  openRisk: []
}>()

const { t } = useI18n()

// ── Сворачивание (общий ключ на пользователя, не на отклик) ──
const collapsed = useState<boolean>('discussion-widgets-collapsed', () => false)

// ── AI-скрининг (per-application) ──
interface CriterionScore {
  criterionKey: string
  criterionName: string | null
  maxScore: number
  score: number
  confidence: number | null
  gaps: string | null
  strengths: string | null
}
interface ScoresResponse {
  compositeScore: number | null
  scores: CriterionScore[]
  latestRun: { status: string, model: string | null, createdAt: string } | null
}

const { data: scores } = useFetch<ScoresResponse>(
  () => `/api/applications/${props.applicationId}/scores`,
  {
    key: computed(() => `disc-scores-${props.applicationId}`),
    headers: useRequestHeaders(['cookie']),
    watch: [() => props.applicationId],
    default: () => ({ compositeScore: null, scores: [], latestRun: null }),
  },
)

const hasScreening = computed(() => scores.value?.compositeScore != null && (scores.value?.scores.length ?? 0) > 0)

/** Топ-2 самых слабых критерия (для «пробелов»). */
const topGaps = computed(() => {
  const list = scores.value?.scores ?? []
  return [...list]
    .filter(c => c.maxScore > 0)
    .sort((a, b) => (a.score / a.maxScore) - (b.score / b.maxScore))
    .slice(0, 2)
    .map(c => c.criterionName || c.criterionKey)
})

function scoreTone(v: number): string {
  if (v >= 75) return 'text-success-600 dark:text-success-400'
  if (v >= 40) return 'text-warning-600 dark:text-warning-400'
  return 'text-danger-600 dark:text-danger-400'
}

// ── Риски (per-candidate) ──
const { profile: riskProfile } = useResumeRisk(() => props.candidateId)
const risk = computed(() => riskProfile.value?.risk ?? null)
const riskStale = computed(() => Boolean(riskProfile.value?.stale))
const hasRisk = computed(() => risk.value?.status === 'completed')
const findingsCount = computed(() => risk.value?.findingsJson?.findings?.length ?? 0)

const riskMeta = computed(() => {
  const level = risk.value?.overallRisk ?? 'low'
  const map = {
    low: { label: t('discussion_widgets.risk_low'), cls: 'bg-success-100 text-success-800 dark:bg-success-900/40 dark:text-success-200' },
    medium: { label: t('discussion_widgets.risk_medium'), cls: 'bg-warning-100 text-warning-800 dark:bg-warning-900/40 dark:text-warning-200' },
    high: { label: t('discussion_widgets.risk_high'), cls: 'bg-danger-100 text-danger-800 dark:bg-danger-900/40 dark:text-danger-200' },
  } as const
  return map[level as keyof typeof map] ?? map.low
})

const anyData = computed(() => hasScreening.value || hasRisk.value)
</script>

<template>
  <div class="mb-3">
    <!-- Заголовок-переключатель -->
    <button
      type="button"
      class="flex w-full items-center justify-between gap-2 rounded-md px-1 py-1 text-xs font-medium text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-200 cursor-pointer"
      @click="collapsed = !collapsed"
    >
      <span class="flex items-center gap-1.5">
        <Bot class="size-3.5" />
        {{ t('discussion_widgets.title') }}
      </span>
      <component :is="collapsed ? ChevronDown : ChevronUp" class="size-3.5" />
    </button>

    <div v-show="!collapsed" class="mt-1.5 grid gap-2" :class="compact ? 'grid-cols-1' : 'sm:grid-cols-2'">
      <!-- AI-скрининг -->
      <div class="rounded-lg border border-surface-200 dark:border-surface-800 bg-surface-50/60 dark:bg-surface-900/40 p-3">
        <div class="flex items-center justify-between gap-2">
          <span class="flex items-center gap-1.5 text-xs font-semibold text-surface-600 dark:text-surface-300">
            <Bot class="size-3.5 text-brand-500" />
            {{ t('discussion_widgets.screening') }}
          </span>
          <button
            v-if="hasScreening"
            type="button"
            class="inline-flex items-center gap-0.5 text-[11px] text-brand-600 dark:text-brand-400 hover:underline cursor-pointer"
            @click="emit('openScreening')"
          >
            {{ t('discussion_widgets.details') }}
            <ExternalLink class="size-3" />
          </button>
        </div>

        <div v-if="hasScreening" class="mt-1.5 flex items-baseline gap-2">
          <span class="text-2xl font-bold tabular-nums" :class="scoreTone(scores!.compositeScore!)">
            {{ scores!.compositeScore }}
          </span>
          <span class="text-[11px] text-surface-400">/ 100</span>
        </div>
        <div v-if="hasScreening && topGaps.length > 0" class="mt-1.5">
          <span class="text-[11px] text-surface-400">{{ t('discussion_widgets.gaps') }}:</span>
          <div class="mt-0.5 flex flex-wrap gap-1">
            <span
              v-for="g in topGaps"
              :key="g"
              class="rounded bg-danger-50 dark:bg-danger-900/20 px-1.5 py-0.5 text-[10px] text-danger-700 dark:text-danger-300"
            >
              {{ g }}
            </span>
          </div>
        </div>
        <p v-else-if="!hasScreening" class="mt-1.5 text-[11px] italic text-surface-400">
          {{ t('discussion_widgets.screening_empty') }}
        </p>
      </div>

      <!-- Оценка рисков -->
      <div class="rounded-lg border border-surface-200 dark:border-surface-800 bg-surface-50/60 dark:bg-surface-900/40 p-3">
        <div class="flex items-center justify-between gap-2">
          <span class="flex items-center gap-1.5 text-xs font-semibold text-surface-600 dark:text-surface-300">
            <ShieldAlert class="size-3.5 text-amber-500" />
            {{ t('discussion_widgets.risk') }}
          </span>
          <button
            v-if="hasRisk"
            type="button"
            class="inline-flex items-center gap-0.5 text-[11px] text-brand-600 dark:text-brand-400 hover:underline cursor-pointer"
            @click="emit('openRisk')"
          >
            {{ t('discussion_widgets.details') }}
            <ExternalLink class="size-3" />
          </button>
        </div>

        <div v-if="hasRisk" class="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span class="rounded px-1.5 py-0.5 text-[11px] font-semibold" :class="riskMeta.cls">
            {{ riskMeta.label }}
          </span>
          <span
            v-if="findingsCount > 0"
            class="inline-flex items-center gap-0.5 text-[11px] text-surface-500 dark:text-surface-400"
          >
            <AlertTriangle class="size-3 text-amber-500" />
            {{ t('discussion_widgets.findings', { n: findingsCount }) }}
          </span>
          <span
            v-if="riskStale"
            class="rounded bg-surface-200 dark:bg-surface-700 px-1.5 py-0.5 text-[10px] text-surface-500 dark:text-surface-300"
            :title="t('discussion_widgets.stale_hint')"
          >
            {{ t('discussion_widgets.stale') }}
          </span>
        </div>
        <p v-if="hasRisk && risk?.summary" class="mt-1 line-clamp-2 text-[11px] text-surface-500 dark:text-surface-400">
          {{ risk.summary }}
        </p>
        <p v-else-if="!hasRisk" class="mt-1.5 text-[11px] italic text-surface-400">
          {{ t('discussion_widgets.risk_empty') }}
        </p>
      </div>
    </div>
  </div>
</template>
